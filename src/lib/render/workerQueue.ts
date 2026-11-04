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
    const fnPromise = fn(ac.signal);
    fnPromise.catch(() => { /* kalau timeout menang duluan, rejection fn yg menyusul jangan jadi unhandled */ });
    const value = await Promise.race([fnPromise, timeout]);
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
type SchedEntry = { start: () => void; cancelled: boolean };
export class FairScheduler {
  private queues = new Map<string, SchedEntry[]>();      // tenant -> antrean entri (FIFO per tenant)
  private order: string[] = [];                          // tenant dikenal (urutan kedatangan, utk tie-break)
  private served = new Map<string, number>();            // berapa kali tiap tenant sudah dilayani (fairness)
  private running = 0;
  constructor(private readonly maxConcurrent: number) {}
  runningCount(): number { return this.running; }
  private liveCount(q: SchedEntry[] | undefined): number { let s = 0; for (const e of q ?? []) if (!e.cancelled) s++; return s; }
  waitingCount(tenantId?: string): number {
    if (tenantId) return this.liveCount(this.queues.get(tenantId));
    let s = 0; for (const q of this.queues.values()) s += this.liveCount(q); return s;
  }
  // Fair: dari tenant yg PUNYA entri HIDUP menunggu, pilih yg PALING SEDIKIT dilayani (tie -> urutan
  // kedatangan) -> tak ada tenant memonopoli worker serial (anti-starvation), beda dgn FIFO polos.
  private nextTenant(): string | undefined {
    let best: string | undefined; let bestServed = Infinity;
    for (const t of this.order) {
      if (this.liveCount(this.queues.get(t)) === 0) continue;
      const c = this.served.get(t) ?? 0;
      if (c < bestServed) { best = t; bestServed = c; }
    }
    return best;
  }
  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const tenant = this.nextTenant();
      if (!tenant) break;
      const q = this.queues.get(tenant) as SchedEntry[];
      let entry: SchedEntry | undefined;
      while (q.length) { const e = q.shift() as SchedEntry; if (!e.cancelled) { entry = e; break; } } // buang entri cancelled (queue-timeout)
      if (!entry) continue;
      this.served.set(tenant, (this.served.get(tenant) ?? 0) + 1);
      this.running++;
      entry.start();
    }
  }
  // opts.queueTimeoutMs: kalau job tak dapat giliran dalam waktu itu -> cancel + reject {__queueTimeout}
  // (pemanggil fallback ffmpeg). opts.onDequeue(waitedMs): dipanggil saat mulai jalan (catat waktu antre).
  schedule<T>(tenantId: string, task: () => Promise<T>, opts?: { queueTimeoutMs?: number; onDequeue?: (waitedMs: number) => void }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const enqueuedAt = Date.now();
      let qTimer: ReturnType<typeof setTimeout> | undefined;
      const entry: SchedEntry = { cancelled: false, start: () => { /* diisi di bawah */ } };
      entry.start = () => {
        if (qTimer) clearTimeout(qTimer);
        try { opts?.onDequeue?.(Date.now() - enqueuedAt); } catch { /* log tak boleh ganggu render */ }
        task().then(resolve, reject).finally(() => { this.running--; this.pump(); });
      };
      if (opts?.queueTimeoutMs != null) {
        qTimer = setTimeout(() => {
          if (!entry.cancelled) { entry.cancelled = true; reject(Object.assign(new Error(`queue timeout ${opts.queueTimeoutMs}ms`), { __queueTimeout: true })); }
        }, opts.queueTimeoutMs);
      }
      if (!this.queues.has(tenantId)) { this.queues.set(tenantId, []); this.order.push(tenantId); }
      (this.queues.get(tenantId) as SchedEntry[]).push(entry);
      this.pump();
    });
  }
}

export function isQueueTimeout(err: unknown): boolean { return (err as { __queueTimeout?: boolean })?.__queueTimeout === true; }
