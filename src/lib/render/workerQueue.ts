// Antrean worker render - RANCANGAN Tahap 3 (2026-11-04). Fungsi MURNI, BELUM dipanggil pipeline
// (nol dampak prod sampai wiring pasca-Gerbang 2). Lihat docs/worker-queue-design.md. Teruji:
// scripts/verify-worker-queue.ts (mock: worker hang, antrean penuh, fallback).

// (3a) Bagi anggaran deadline: antre jangan menghabiskan deadline render. remaining = total - antre.
// remaining < minRender -> JANGAN mulai (proceed=false) -> pemanggil fallback ffmpeg.
export function splitRenderBudget(opts: { totalDeadlineMs: number; queueWaitedMs: number; minRenderMs: number }): { renderDeadlineMs: number; proceed: boolean } {
  const remaining = opts.totalDeadlineMs - Math.max(0, opts.queueWaitedMs);
  if (remaining < opts.minRenderMs) return { renderDeadlineMs: Math.max(0, remaining), proceed: false };
  return { renderDeadlineMs: remaining, proceed: true };
}

export type SlotResult<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "error"; error: unknown };

// (3b) Jalankan render dgn timeout KERAS sisi-klien. Lewat -> abort + lepas slot SEGERA (onRelease),
// return reason "timeout" -> render berikut tak nunggu timeout worker 15min. onRelease dipanggil TEPAT 1x.
export async function runWithSlotTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, onRelease?: () => void): Promise<SlotResult<T>> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = false;
  const release = () => { if (!released) { released = true; try { onRelease?.(); } catch { /* lepas slot tak boleh melempar */ } } };
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ac.abort(); reject(Object.assign(new Error(`slot timeout ${timeoutMs}ms`), { __slotTimeout: true })); }, timeoutMs);
    });
    const value = await Promise.race([fn(ac.signal), timeout]);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: (e as { __slotTimeout?: boolean })?.__slotTimeout ? "timeout" : "error", error: e };
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
}

// (4a) Retry terbatas (hanya transient; timeout render TIDAK di-retry). Habis -> null -> fallback ffmpeg.
export function nextRetryDelayMs(attempt: number, opts: { maxAttempts: number; baseMs: number; capMs?: number }): number | null {
  if (attempt >= opts.maxAttempts) return null;
  const d = opts.baseMs * Math.pow(2, attempt);
  return Math.min(d, opts.capMs ?? d);
}
// Retry hanya untuk kegagalan transient (jaringan/5xx), BUKAN timeout render (mahal, pasti berulang).
export function isRetriable(reason: "timeout" | "error", err: unknown): boolean {
  if (reason === "timeout") return false;
  const msg = String((err as Error)?.message || err).toLowerCase();
  return /econnreset|econnrefused|etimedout|socket hang up|502|503|504|tunnel/.test(msg);
}

export type QuotaResult = { ok: true } | { ok: false; reason: "tenant_limit" | "global_full" };

// (4b) Kuota per tenant (in-memory, per instance app). Batasi render BERSAMAAN per tenant + total global
// -> anti-monopoli worker serial. Penuh -> tolak (fallback cepat), bukan antre tak terbatas.
export class TenantQuota {
  private active = new Map<string, number>();
  constructor(private readonly maxConcurrentPerTenant: number, private readonly maxGlobalInFlight: number) {}
  private globalCount(): number { let s = 0; for (const v of this.active.values()) s += v; return s; }
  inFlight(tenantId?: string): number { return tenantId ? (this.active.get(tenantId) ?? 0) : this.globalCount(); }
  tryAcquire(tenantId: string): QuotaResult {
    if (this.globalCount() >= this.maxGlobalInFlight) return { ok: false, reason: "global_full" };
    const cur = this.active.get(tenantId) ?? 0;
    if (cur >= this.maxConcurrentPerTenant) return { ok: false, reason: "tenant_limit" };
    this.active.set(tenantId, cur + 1);
    return { ok: true };
  }
  release(tenantId: string): void {
    const cur = this.active.get(tenantId) ?? 0;
    if (cur <= 1) this.active.delete(tenantId); else this.active.set(tenantId, cur - 1);
  }
}
