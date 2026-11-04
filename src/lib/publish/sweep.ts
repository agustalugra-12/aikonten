// Sweep rekonsiliasi Buffer (feat/publish-guard). Logika MURNI (tanpa jaringan/DB) -> testable.
// I/O ada di sweepRunner.ts. Flag BUFFER_SWEEP_ENABLED default OFF -> jalur verifikasi lama tetap jalan.

// Dibaca saat call (bukan module-load) -> bisa diubah lewat env tanpa rebuild & testable.
export const sweepEnabled = (): boolean => process.env.BUFFER_SWEEP_ENABLED === "1" || process.env.BUFFER_SWEEP_ENABLED === "true";

// Satu pending (dari tabel buffer_pending_checks, persisten).
export type PendingCheck = {
  id: string;
  platformPostId: string; // WAJIB: pencocokan HANYA by id (bukan teks)
  text: string;           // caption persis yang dikirim (utk deteksi duplikat)
  createdAtMs: number;
  dupHandled: boolean;
};
// Node post dari SATU query Buffer `posts` per channel.
export type BufferPost = { id: string; text: string; status: string; externalLink?: string | null };

export type SweepCfg = { nowMs: number; dupWindowMs: number; stuckMs: number };
export const defaultSweepCfg = (nowMs: number): SweepCfg => ({ nowMs, dupWindowMs: 5 * 60_000, stuckMs: 20 * 60_000 });

export type SweepResult = {
  confirmed: string[];                                            // pending id: status sent & lewat jendela duplikat -> selesai
  waiting: string[];                                              // belum final (sending / baru) -> cek sweep berikutnya
  errored: Array<{ pendingId: string; status: string }>;          // Buffer status error -> koreksi + notif
  stuck: Array<{ pendingId: string; status: string }>;            // tak kunjung sent / tak ketemu > stuckMs -> koreksi + notif
  duplicates: Array<{ pendingId: string; postId: string; externalLink: string | null }>;
};

// Rekonsiliasi SATU channel. Aturan aman:
//  - pending dicocokkan ke post Buffer HANYA lewat platformPostId.
//  - duplikat = post lain di channel yang SAMA, teks IDENTIK dengan post kita yang TERKONFIRMASI ada (by id),
//    DAN id-nya bukan post milik aplikasi ini yang tercatat (knownPostIds). Jadi tak pernah menghapus post kita
//    sendiri dan tak pernah menghapus hanya karena teks mirip.
export function reconcileSweep(pending: PendingCheck[], posts: BufferPost[], knownPostIds: Set<string>, cfg: SweepCfg): SweepResult {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const out: SweepResult = { confirmed: [], waiting: [], errored: [], stuck: [], duplicates: [] };
  for (const c of pending) {
    const age = cfg.nowMs - c.createdAtMs;
    const post = byId.get(c.platformPostId);
    if (post && !c.dupHandled) {
      for (const p of posts) {
        if (p.id !== post.id && p.text === post.text && p.text === c.text && !knownPostIds.has(p.id)) {
          out.duplicates.push({ pendingId: c.id, postId: p.id, externalLink: p.externalLink ?? null });
        }
      }
    }
    const st = (post?.status || "").toLowerCase();
    if (post && st === "error") out.errored.push({ pendingId: c.id, status: post.status });
    else if (post && st === "sent") (age >= cfg.dupWindowMs ? out.confirmed : out.waiting).push(c.id);
    else if (age > cfg.stuckMs) out.stuck.push({ pendingId: c.id, status: post ? post.status : "tidak ditemukan" });
    else out.waiting.push(c.id);
  }
  return out;
}

// Gate: sweep channel HANYA kalau ada pending (jangan poll channel kosong).
export function channelsToSweep<T extends { channelId: string }>(pending: T[]): string[] {
  return [...new Set(pending.map((p) => p.channelId))];
}

// Analytics dibatasi budget: hanya channel yg stale (belum sync > minIntervalMs) + cap jumlah per siklus.
export type AnalyticsCand = { channelId: string; lastSyncedMs: number | null };
export function analyticsToSync(cands: AnalyticsCand[], nowMs: number, minIntervalMs: number, maxPerCycle: number): string[] {
  return cands
    .filter((c) => c.lastSyncedMs == null || nowMs - c.lastSyncedMs >= minIntervalMs)
    .slice(0, Math.max(0, maxPerCycle))
    .map((c) => c.channelId);
}

// Ledger: rata-rata call Buffer per KONTEN sukses (global / per platform / per brand).
export type CallLedgerRow = { brandId: string; platform: string; calls: number; successfulContent: number };
export function avgCallsPerContent(totalCalls: number, successfulContent: number): number {
  return successfulContent > 0 ? totalCalls / successfulContent : 0;
}
export function ledgerBreakdown(rows: CallLedgerRow[]): { overall: number; byPlatform: Record<string, number>; byBrand: Record<string, number> } {
  const sum = (sel: (r: CallLedgerRow) => string) => {
    const acc: Record<string, { c: number; s: number }> = {};
    for (const r of rows) { const k = sel(r); (acc[k] ??= { c: 0, s: 0 }); acc[k].c += r.calls; acc[k].s += r.successfulContent; }
    const res: Record<string, number> = {};
    for (const k of Object.keys(acc)) res[k] = avgCallsPerContent(acc[k].c, acc[k].s);
    return res;
  };
  const totalCalls = rows.reduce((a, r) => a + r.calls, 0);
  const totalContent = rows.reduce((a, r) => a + r.successfulContent, 0);
  return { overall: avgCallsPerContent(totalCalls, totalContent), byPlatform: sum((r) => r.platform), byBrand: sum((r) => r.brandId) };
}

// Estimasi call/konten jalur SWEEP dari parameter NYATA (bukan asumsi 20 post/sweep):
//   createPost 1 + (sweep call per pending = sweepRuns x channelsPerRun / pendingHandled) + analytics/konten.
export function estimateSweepCallsPerContent(o: { postsPerChannelPerDay: number; sweepIntervalMin: number; pendingLifetimeMin: number; analyticsCallsPerDayPerChannel: number }): number {
  const postsPerDay = Math.max(o.postsPerChannelPerDay, 1e-9);
  // Channel di-sweep hanya selama ada pending; tiap post membuka jendela ~pendingLifetime menit.
  const sweepsPerPost = Math.max(1, Math.ceil(o.pendingLifetimeMin / o.sweepIntervalMin));
  // Kalau post sering (jendela tumpang tindih), 1 sweep melayani beberapa post sekaligus.
  const overlap = Math.max(1, (postsPerDay * o.pendingLifetimeMin) / (24 * 60));
  const sweepPerPost = sweepsPerPost / overlap;
  return 1 + sweepPerPost + o.analyticsCallsPerDayPerChannel / postsPerDay;
}

// Model lama (dipertahankan utk kontrol tes): createPost + sweep teramortisasi + analytics.
export function modeledCallsPerContent(opts: { createPostCalls: number; sweepCallsPerCycle: number; postsReconciledPerCycle: number; analyticsCallsPerCycle: number; contentPerCycle: number }): number {
  const dedupVerify = opts.postsReconciledPerCycle > 0 ? opts.sweepCallsPerCycle / opts.postsReconciledPerCycle : 0;
  const analytics = opts.contentPerCycle > 0 ? opts.analyticsCallsPerCycle / opts.contentPerCycle : 0;
  return opts.createPostCalls + dedupVerify + analytics;
}
