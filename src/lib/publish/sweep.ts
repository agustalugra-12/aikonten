// Sweep rekonsiliasi Buffer (feat/publish-guard, 2026-11-04). Ganti polling PER-POST (dup-check + verifikasi
// status via setTimeout per post) dengan SATU query `posts` per channel/token tiap siklus -> turunkan call
// Buffer dari ~19/konten ke <=5/konten. Fungsi MURNI (tanpa jaringan/DB) supaya TESTABLE; cron/orchestrate
// memanggilnya. Pending check DIAMBIL dari DB (publish_logs) -> tahan restart.

// Satu baris publish_logs yg BELUM final & punya platform_post_id -> perlu dicek sweep (dari DB, persisten).
export type PendingCheck = {
  projectId: string;
  socialAccountId: string;
  platform: string;          // instagram/facebook/tiktok/youtube...
  platformPostId: string | null; // id post di Buffer (kalau sudah ada)
  text: string;              // caption -> cocokkan ke post Buffer utk deteksi duplikat
  status: string;            // status publish_logs saat ini (success/failed/pending)
};
// Node post dari SATU query Buffer `posts` per channel (id, text, status terbaru).
export type BufferPost = { id: string; text: string; status: string };

export type SweepResult = {
  confirmed: Array<{ projectId: string; socialAccountId: string; postId: string }>; // terkirim OK di Buffer
  errored: Array<{ projectId: string; socialAccountId: string; postId: string; status: string }>; // Buffer tandai error/gagal
  duplicates: Array<{ postId: string; text: string }>; // post Buffer kelebihan utk teks yg sama -> hapus 1
  missing: Array<{ projectId: string; socialAccountId: string }>; // pending tapi tak ketemu di Buffer (belum muncul)
};

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
const OK = new Set(["sent", "published", "success", "complete", "completed"]);
const ERR = new Set(["error", "failed", "rejected"]);

// Rekonsiliasi SATU channel: cocokkan daftar pending (dari DB) dengan posts Buffer (1 query). Deteksi
// duplikat (>=2 post Buffer teks sama -> sisanya duplikat) + verifikasi status sekaligus. NOL call per-post.
export function reconcileSweep(pending: PendingCheck[], bufferPosts: BufferPost[]): SweepResult {
  const byId = new Map(bufferPosts.map((p) => [p.id, p]));
  // Kelompokkan post Buffer per teks-ternormalisasi -> deteksi duplikat (Buffer kadang jadikan 1 request 2 post).
  const byText = new Map<string, BufferPost[]>();
  for (const p of bufferPosts) { const k = norm(p.text); (byText.get(k) ?? byText.set(k, []).get(k)!).push(p); }

  const confirmed: SweepResult["confirmed"] = [];
  const errored: SweepResult["errored"] = [];
  const missing: SweepResult["missing"] = [];
  for (const c of pending) {
    const post = (c.platformPostId && byId.get(c.platformPostId)) || byText.get(norm(c.text))?.[0];
    if (!post) { missing.push({ projectId: c.projectId, socialAccountId: c.socialAccountId }); continue; }
    const st = post.status.toLowerCase();
    if (ERR.has(st)) errored.push({ projectId: c.projectId, socialAccountId: c.socialAccountId, postId: post.id, status: post.status });
    else if (OK.has(st)) confirmed.push({ projectId: c.projectId, socialAccountId: c.socialAccountId, postId: post.id });
    // status lain (processing/queued) -> biarkan pending utk sweep berikutnya
  }
  // Duplikat: utk tiap teks dgn >1 post Buffer, post ke-2+ = duplikat (dihapus pemanggil; notifikasi tetap jalan).
  const duplicates: SweepResult["duplicates"] = [];
  for (const posts of byText.values()) {
    if (posts.length > 1) for (const extra of posts.slice(1)) duplicates.push({ postId: extra.id, text: extra.text });
  }
  return { confirmed, errored, duplicates, missing };
}

// #4 Gate: sweep channel HANYA kalau ada pending (jangan poll channel kosong).
export function channelsToSweep<T extends { channelId: string }>(pending: T[]): string[] {
  return [...new Set(pending.map((p) => p.channelId))];
}

// #5 Analytics dibatasi budget: hanya channel yg stale (belum sync > minIntervalMs) + cap jumlah per siklus.
export type AnalyticsCand = { channelId: string; lastSyncedMs: number | null };
export function analyticsToSync(cands: AnalyticsCand[], nowMs: number, minIntervalMs: number, maxPerCycle: number): string[] {
  return cands
    .filter((c) => c.lastSyncedMs == null || nowMs - c.lastSyncedMs >= minIntervalMs)
    .slice(0, Math.max(0, maxPerCycle))
    .map((c) => c.channelId);
}

// #6 Ledger: rata-rata call Buffer per KONTEN sukses (global / per platform / per brand).
export type CallLedgerRow = { brandId: string; platform: string; calls: number; successfulContent: number };
export function avgCallsPerContent(totalCalls: number, successfulContent: number): number {
  return successfulContent > 0 ? totalCalls / successfulContent : 0;
}
export function ledgerBreakdown(rows: CallLedgerRow[]): {
  overall: number;
  byPlatform: Record<string, number>;
  byBrand: Record<string, number>;
} {
  const sum = (sel: (r: CallLedgerRow) => string) => {
    const acc: Record<string, { c: number; s: number }> = {};
    for (const r of rows) { const k = sel(r); (acc[k] ??= { c: 0, s: 0 }); acc[k].c += r.calls; acc[k].s += r.successfulContent; }
    const out: Record<string, number> = {};
    for (const k of Object.keys(acc)) out[k] = avgCallsPerContent(acc[k].c, acc[k].s);
    return out;
  };
  const totalCalls = rows.reduce((a, r) => a + r.calls, 0);
  const totalContent = rows.reduce((a, r) => a + r.successfulContent, 0);
  return { overall: avgCallsPerContent(totalCalls, totalContent), byPlatform: sum((r) => r.platform), byBrand: sum((r) => r.brandId) };
}

// Model biaya call/konten SETELAH sweep (utk memverifikasi target <=5):
//   per konten = createPost(1) + dedup/verify TERAMORTISASI (callsSweepPerChannel / postsPerSweep) + analyticsPerContent.
// Polling lama: createPost + dup-check-per-post + verify-per-post (>=1 masing-masing) -> ~>=3-19. Sweep: ~1 + ~0 + kecil.
export function modeledCallsPerContent(opts: { createPostCalls: number; sweepCallsPerCycle: number; postsReconciledPerCycle: number; analyticsCallsPerCycle: number; contentPerCycle: number }): number {
  const dedupVerify = opts.postsReconciledPerCycle > 0 ? opts.sweepCallsPerCycle / opts.postsReconciledPerCycle : 0;
  const analytics = opts.contentPerCycle > 0 ? opts.analyticsCallsPerCycle / opts.contentPerCycle : 0;
  return opts.createPostCalls + dedupVerify + analytics;
}
