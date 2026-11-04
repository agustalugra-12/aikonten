// Antrean worker render - RANCANGAN ULANG Tahap 3 (2026-11-04) berbasis WORKER AKTIF (4-core/8GB, serial,
// RENDER_TIMEOUT_MS 25min, tanpa job-id/status/cancel). Fungsi MURNI, BELUM dipanggil pipeline (nol dampak
// prod sampai wiring pasca-Gerbang 2). Lihat docs/worker-queue-design.md. Teruji scripts/verify-worker-queue.ts.

// (anti render ganda) Idempotency key: deterministik dari konten -> retry/submit-ulang pakai id SAMA.
export function makeJobId(tenantId: string, projectId: string, contentHash: string): string {
  return `${tenantId}:${projectId}:${contentHash}`;
}

// (anti render ganda) Registry in-flight: submit dgn jobId yg SEDANG jalan -> kembalikan promise SAMA
// (tak men-start render kedua). Entri dibersihkan saat selesai (sukses/gagal) -> submit berikutnya fresh.
export class InFlightRegistry<T> {
  private map = new Map<string, Promise<T>>();
  run(jobId: string, start: () => Promise<T>): { deduped: boolean; promise: Promise<T> } {
    const existing = this.map.get(jobId);
    if (existing) return { deduped: true, promise: existing };
    const p = (async () => { try { return await start(); } finally { this.map.delete(jobId); } })();
    this.map.set(jobId, p);
    return { deduped: false, promise: p };
  }
  has(jobId: string): boolean { return this.map.has(jobId); }
  size(): number { return this.map.size; }
}

// (antre jangan makan deadline) Bagi anggaran: remaining = total - antre. < minRender -> jangan mulai (fallback).
export function splitRenderBudget(opts: { totalDeadlineMs: number; queueWaitedMs: number; minRenderMs: number }): { renderDeadlineMs: number; proceed: boolean } {
  const remaining = opts.totalDeadlineMs - Math.max(0, opts.queueWaitedMs);
  if (remaining < opts.minRenderMs) return { renderDeadlineMs: Math.max(0, remaining), proceed: false };
  return { renderDeadlineMs: remaining, proceed: true };
}

// (waktu antre DIKETAHUI) Estimasi tunggu dari posisi antre + rata-rata durasi render. Dipakai SEBELUM antre:
// kalau estimasi > sisa budget -> fallback ffmpeg (bukan antre sia-sia). Selain itu -> antre adil.
export function estimateWaitMs(opts: { aheadInQueue: number; running: number; maxConcurrent: number; avgRenderMs: number }): number {
  // job harus menunggu giliran: (antre di depan + sedang jalan) dibagi slot paralel, dikali durasi rata2.
  const batchesAhead = Math.ceil((opts.aheadInQueue + opts.running) / Math.max(1, opts.maxConcurrent)) - 1;
  return Math.max(0, batchesAhead) * opts.avgRenderMs;
}

export type SlotResult<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "error"; error: unknown };

// (timeout membatalkan WORKER, bukan cuma client) Jalankan render dgn timeout keras. Lewat -> abort client
// + panggil onTimeout() (hit /cancel/:jobId di worker utk bunuh proses render) + reason "timeout". onSettle 1x.
export async function runWithSlotTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  hooks?: { onTimeout?: () => void | Promise<void>; onSettle?: () => void },
): Promise<SlotResult<T>> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const settle = () => { if (!settled) { settled = true; try { hooks?.onSettle?.(); } catch { /* lepas slot tak boleh melempar */ } } };
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(async () => {
        ac.abort();
        try { await hooks?.onTimeout?.(); } catch { /* cancel best-effort; tetap fallback */ }
        reject(Object.assign(new Error(`slot timeout ${timeoutMs}ms`), { __slotTimeout: true }));
      }, timeoutMs);
    });
    const value = await Promise.race([fn(ac.signal), timeout]);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: (e as { __slotTimeout?: boolean })?.__slotTimeout ? "timeout" : "error", error: e };
  } finally {
    if (timer) clearTimeout(timer);
    settle();
  }
}

// (retry terbatas) Hanya transient (jaringan/5xx), BUKAN timeout render (mahal). Habis -> null -> fallback.
export function nextRetryDelayMs(attempt: number, opts: { maxAttempts: number; baseMs: number; capMs?: number }): number | null {
  if (attempt >= opts.maxAttempts) return null;
  const d = opts.baseMs * Math.pow(2, attempt);
  return Math.min(d, opts.capMs ?? d);
}
export function isRetriable(reason: "timeout" | "error", err: unknown): boolean {
  if (reason === "timeout") return false;
  const msg = String((err as Error)?.message || err).toLowerCase();
  return /econnreset|econnrefused|etimedout|socket hang up|502|503|504|tunnel/.test(msg);
}

// (kuota per tenant ADIL - antre, bukan langsung fallback) Scheduler round-robin lintas tenant + batas
// konkurensi global. Job MENUNGGU giliran (fair), tak ditolak saat contention biasa. waitingCount ->
// waktu antre diketahui. Fallback = keputusan pemanggil via estimateWaitMs > budget (sebelum schedule).
export class FairScheduler {
  private queues = new Map<string, Array<() => void>>(); // tenant -> antrean callback "mulai" (FIFO per tenant)
  private order: string[] = [];                          // tenant dikenal (urutan kedatangan, utk tie-break)
  private served = new Map<string, number>();            // berapa kali tiap tenant sudah dilayani (fairness)
  private running = 0;
  constructor(private readonly maxConcurrent: number) {}
  runningCount(): number { return this.running; }
  waitingCount(tenantId?: string): number {
    if (tenantId) return this.queues.get(tenantId)?.length ?? 0;
    let s = 0; for (const q of this.queues.values()) s += q.length; return s;
  }
  // Fair: dari tenant yg PUNYA job menunggu, pilih yg PALING SEDIKIT dilayani (tie -> urutan kedatangan).
  // -> tak ada tenant memonopoli worker serial (anti-starvation), beda dgn FIFO polos.
  private nextTenant(): string | undefined {
    let best: string | undefined; let bestServed = Infinity;
    for (const t of this.order) {
      if ((this.queues.get(t)?.length ?? 0) === 0) continue;
      const c = this.served.get(t) ?? 0;
      if (c < bestServed) { best = t; bestServed = c; }
    }
    return best;
  }
  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const tenant = this.nextTenant();
      if (!tenant) break;
      const startNext = (this.queues.get(tenant) as Array<() => void>).shift() as () => void;
      this.served.set(tenant, (this.served.get(tenant) ?? 0) + 1);
      this.running++;
      startNext();
    }
  }
  schedule<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => { task().then(resolve, reject).finally(() => { this.running--; this.pump(); }); };
      if (!this.queues.has(tenantId)) { this.queues.set(tenantId, []); this.order.push(tenantId); }
      (this.queues.get(tenantId) as Array<() => void>).push(start);
      this.pump();
    });
  }
}
