// Tes sweep rekonsiliasi Buffer (feat/publish-guard). npx tsx scripts/verify-publish-sweep.ts
// Cakup: 20 post 1 channel -> SATU sweep, duplikat+error tetap terdeteksi, pending dari DB (tahan restart),
// multi-tenant, rata-rata call <=5, gate channel kosong + analytics dibatasi.
import assert from "node:assert";
import { reconcileSweep, channelsToSweep, analyticsToSync, avgCallsPerContent, ledgerBreakdown, modeledCallsPerContent, type PendingCheck, type BufferPost } from "@/lib/publish/sweep";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

// 1. 20 post satu channel -> SATU sweep (1 query), semua terkonfirmasi tanpa call per-post.
{
  const pending: PendingCheck[] = Array.from({ length: 20 }, (_, i) => ({ projectId: `p${i}`, socialAccountId: "accA", platform: "instagram", platformPostId: `buf${i}`, text: `caption ${i}`, status: "pending" }));
  const posts: BufferPost[] = Array.from({ length: 20 }, (_, i) => ({ id: `buf${i}`, text: `caption ${i}`, status: "sent" }));
  const chans = channelsToSweep(pending.map((p) => ({ channelId: p.socialAccountId })));
  assert.strictEqual(chans.length, 1, "20 post 1 channel -> 1 channel di-sweep (1 query)");
  const r = reconcileSweep(pending, posts);
  assert.strictEqual(r.confirmed.length, 20, "20 pending terkonfirmasi dalam 1 sweep");
  assert.strictEqual(r.errored.length, 0);
  ok("20 post 1 channel -> SATU sweep (1 query, 0 call per-post)");
}

// 2. Duplikat + post error TETAP terdeteksi dalam sweep.
{
  const pending: PendingCheck[] = [
    { projectId: "pA", socialAccountId: "accA", platform: "facebook", platformPostId: "x1", text: "Promo kamar sejuk", status: "pending" },
    { projectId: "pB", socialAccountId: "accA", platform: "facebook", platformPostId: "x3", text: "Diskon weekend", status: "pending" },
  ];
  const posts: BufferPost[] = [
    { id: "x1", text: "Promo kamar sejuk", status: "sent" },
    { id: "x2", text: "Promo kamar sejuk", status: "sent" },   // DUPLIKAT teks sama (Buffer buat 2 post)
    { id: "x3", text: "Diskon weekend", status: "error" },      // post ERROR
  ];
  const r = reconcileSweep(pending, posts);
  assert.strictEqual(r.duplicates.length, 1, "duplikat terdeteksi (1 post kelebihan)");
  assert.strictEqual(r.duplicates[0].postId, "x2");
  assert.strictEqual(r.errored.length, 1, "post error terdeteksi");
  assert.strictEqual(r.errored[0].projectId, "pB");
  assert.strictEqual(r.confirmed.length, 1, "pA terkonfirmasi");
  ok("duplikat + post error tetap terdeteksi lewat sweep (notifikasi tak hilang)");
}

// 3. Pending dari DB (bukan setTimeout) -> tahan restart. Rekonsiliasi MURNI/stateless: rebuild pending ->
//    hasil sama (tak butuh state in-memory yg hilang saat restart).
{
  const dbRows: PendingCheck[] = [{ projectId: "p1", socialAccountId: "accA", platform: "instagram", platformPostId: "b1", text: "halo", status: "pending" }];
  const posts: BufferPost[] = [{ id: "b1", text: "halo", status: "published" }];
  const r1 = reconcileSweep(dbRows, posts);
  const r2 = reconcileSweep(JSON.parse(JSON.stringify(dbRows)), posts); // simulasi rebuild dari DB pasca-restart
  assert.deepStrictEqual(r1, r2, "hasil sweep deterministik dari pending DB (tahan restart)");
  assert.strictEqual(r1.confirmed.length, 1);
  ok("pending dari DB -> sweep stateless, tahan restart (tak hilang)");
}

// 4. Gate: channel kosong TIDAK di-sweep; analytics dibatasi (stale-only + cap).
{
  assert.deepStrictEqual(channelsToSweep([]), [], "tak ada pending -> tak ada channel di-sweep (jangan poll kosong)");
  const now = 1_000_000;
  const cands = [
    { channelId: "c1", lastSyncedMs: null },               // belum pernah -> sync
    { channelId: "c2", lastSyncedMs: now - 10 * 60000 },   // baru 10m lalu -> skip (interval 60m)
    { channelId: "c3", lastSyncedMs: now - 120 * 60000 },  // 2 jam lalu -> stale -> sync
    { channelId: "c4", lastSyncedMs: now - 200 * 60000 },
  ];
  const sel = analyticsToSync(cands, now, 60 * 60000, 2); // cap 2/siklus
  assert.deepStrictEqual(sel, ["c1", "c3"], "analytics: hanya stale + dibatasi cap (hemat budget)");
  ok("gate channel kosong + analytics batch/cap (tak pakai budget publish)");
}

// 5. Multi-tenant: banyak brand/channel -> sweep per channel unik; ledger per brand+platform.
{
  const pending = [
    { channelId: "accPel" }, { channelId: "accPel" }, { channelId: "accLau" }, { channelId: "accAni" },
  ];
  assert.deepStrictEqual(channelsToSweep(pending).sort(), ["accAni", "accLau", "accPel"], "3 channel unik (multi-tenant)");
  const led = ledgerBreakdown([
    { brandId: "pelangi", platform: "instagram", calls: 30, successfulContent: 10 },
    { brandId: "pelangi", platform: "facebook", calls: 10, successfulContent: 10 },
    { brandId: "laundry", platform: "instagram", calls: 8, successfulContent: 4 },
  ]);
  assert.strictEqual(led.byBrand.pelangi, 2, "pelangi (30+10)/(10+10)=2 call/konten");
  assert.strictEqual(led.byBrand.laundry, 2, "laundry 8/4=2");
  assert.strictEqual(led.byPlatform.instagram, (30 + 8) / (10 + 4), "per platform IG");
  ok("multi-tenant: sweep per channel unik + ledger per brand/platform");
}

// 6. Target rata-rata <=5 call/konten (model sweep) vs polling lama.
{
  // Sweep: createPost 1 + sweep 1 call/channel utk 20 post + analytics 1 call/siklus utk 20 konten.
  const sweepAvg = modeledCallsPerContent({ createPostCalls: 1, sweepCallsPerCycle: 1, postsReconciledPerCycle: 20, analyticsCallsPerCycle: 1, contentPerCycle: 20 });
  assert.ok(sweepAvg <= 5, `sweep avg ${sweepAvg.toFixed(2)} <= 5`);
  assert.ok(sweepAvg < 1.2, "sweep ~1.1 call/konten (createPost + teramortisasi)");
  // Bahkan batch kecil (5 post/sweep, analytics tiap siklus) tetap <=5.
  const small = modeledCallsPerContent({ createPostCalls: 1, sweepCallsPerCycle: 1, postsReconciledPerCycle: 5, analyticsCallsPerCycle: 1, contentPerCycle: 5 });
  assert.ok(small <= 5, `batch kecil avg ${small.toFixed(2)} <= 5`);
  // Kontrol: polling lama (dup-check + verify per post + analytics) jauh di atas target.
  assert.strictEqual(avgCallsPerContent(19, 1), 19, "polling lama ~19 call/konten (kontrol)");
  ok("rata-rata call <=5 (sweep ~1.1; polling lama ~19)");
}

console.log(`ALL_PUBLISH_SWEEP_TESTS_PASS (${n} tes)`);
