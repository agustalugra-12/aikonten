// Tes MURNI rekonsiliasi sweep (feat/publish-guard). npx tsx scripts/verify-publish-sweep.ts
import assert from "node:assert";
import { reconcileSweep, channelsToSweep, analyticsToSync, avgCallsPerContent, ledgerBreakdown, estimateSweepCallsPerContent, sweepEnabled, type PendingCheck, type BufferPost } from "@/lib/publish/sweep";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };
const now = 10_000_000;
const cfg = { nowMs: now, dupWindowMs: 5 * 60_000, stuckMs: 20 * 60_000 };
const P = (id: string, postId: string, text: string, ageMin: number, dupHandled = false): PendingCheck => ({ id, platformPostId: postId, text, createdAtMs: now - ageMin * 60_000, dupHandled });

// 1. 20 post satu channel -> SATU channel di-sweep, semua terkonfirmasi (lewat jendela duplikat)
{
  const pending = Array.from({ length: 20 }, (_, i) => P(`p${i}`, `b${i}`, `cap ${i}`, 6));
  const posts: BufferPost[] = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, text: `cap ${i}`, status: "sent" }));
  assert.deepStrictEqual(channelsToSweep(pending.map(() => ({ channelId: "ch1" }))), ["ch1"]);
  const r = reconcileSweep(pending, posts, new Set(posts.map((p) => p.id)), cfg);
  assert.strictEqual(r.confirmed.length, 20);
  ok("20 post satu channel -> 1 channel di-sweep, 20 terkonfirmasi");
}
// 2. Cocok HANYA by platformPostId: teks sama tapi id beda TIDAK dianggap post kita
{
  const r = reconcileSweep([P("p1", "b1", "Promo", 6)], [{ id: "bX", text: "Promo", status: "sent" }], new Set(["b1"]), cfg);
  assert.strictEqual(r.confirmed.length, 0, "tak dicocokkan by teks");
  assert.strictEqual(r.waiting.length, 1, "belum ketemu -> tunggu (belum stuck)");
  ok("pencocokan hanya by platformPostId (bukan teks)");
}
// 3. Duplikat: teks identik + id BUKAN post kita yang tercatat -> duplikat; post kita sendiri tak pernah jadi duplikat
{
  const posts: BufferPost[] = [
    { id: "b1", text: "Promo", status: "sent" },
    { id: "bDUP", text: "Promo", status: "sent", externalLink: "https://x/dup" },
    { id: "b2", text: "Promo", status: "sent" }, // post KITA lain (tercatat) dgn teks sama -> BUKAN duplikat
  ];
  const r = reconcileSweep([P("p1", "b1", "Promo", 6)], posts, new Set(["b1", "b2"]), cfg);
  assert.deepStrictEqual(r.duplicates.map((d) => d.postId), ["bDUP"]);
  const r2 = reconcileSweep([P("p1", "b1", "Promo", 6, true)], posts, new Set(["b1", "b2"]), cfg);
  assert.strictEqual(r2.duplicates.length, 0, "dupHandled -> tak diproses ulang");
  ok("duplikat aman: hanya post asing teks identik; post sendiri tak dihapus; tak diulang");
}
// 4. Status error / stuck / sent-belum-lewat-jendela
{
  const posts: BufferPost[] = [{ id: "e1", text: "a", status: "error" }, { id: "s1", text: "b", status: "sending" }, { id: "n1", text: "c", status: "sent" }];
  const r = reconcileSweep([P("pe", "e1", "a", 2), P("ps", "s1", "b", 25), P("pn", "n1", "c", 2), P("pm", "missing", "d", 30)], posts, new Set(["e1", "s1", "n1"]), cfg);
  assert.deepStrictEqual(r.errored.map((e) => e.pendingId), ["pe"]);
  assert.deepStrictEqual(r.stuck.map((e) => e.pendingId).sort(), ["pm", "ps"]);
  assert.deepStrictEqual(r.waiting, ["pn"], "sent tapi < 5 menit -> tunggu (masih jendela duplikat)");
  ok("error / stuck (>20m / tak ketemu) / sent-dalam-jendela-duplikat");
}
// 5. Gate channel kosong + analytics stale/cap + flag default OFF
{
  assert.deepStrictEqual(channelsToSweep([]), []);
  assert.deepStrictEqual(analyticsToSync([{ channelId: "c1", lastSyncedMs: null }, { channelId: "c2", lastSyncedMs: now }, { channelId: "c3", lastSyncedMs: 0 }], now, 3600_000, 1), ["c1"]);
  delete process.env.BUFFER_SWEEP_ENABLED;
  assert.strictEqual(sweepEnabled(), false, "default OFF");
  ok("channel kosong tak di-sweep; analytics stale+cap; flag default OFF");
}
// 6. Estimasi REALISTIS call/konten (parameter nyata, bukan 20 post/sweep) + ledger breakdown
{
  // Data nyata 30hr: 554 konten sukses / 10 akun / 30 hari = ~1.8 post/channel/hari (jarang -> jendela tak tumpang tindih).
  const est = estimateSweepCallsPerContent({ postsPerChannelPerDay: 554 / 10 / 30, sweepIntervalMin: 20, pendingLifetimeMin: 25, analyticsCallsPerDayPerChannel: 1 });
  assert.ok(est <= 5, `estimasi ${est.toFixed(2)} <= 5`);
  const worst = estimateSweepCallsPerContent({ postsPerChannelPerDay: 0.5, sweepIntervalMin: 15, pendingLifetimeMin: 30, analyticsCallsPerDayPerChannel: 1 });
  assert.ok(worst <= 5, `channel sangat jarang ${worst.toFixed(2)} <= 5`);
  const led = ledgerBreakdown([{ brandId: "pel", platform: "instagram", calls: 30, successfulContent: 10 }, { brandId: "lau", platform: "tiktok", calls: 8, successfulContent: 4 }]);
  assert.strictEqual(led.byBrand.pel, 3); assert.strictEqual(led.byPlatform.tiktok, 2);
  assert.strictEqual(avgCallsPerContent(10513, 554).toFixed(1), "19.0", "kontrol: jalur lama nyata ~19");
  console.log(`    estimasi sweep: ${est.toFixed(2)} call/konten (tipikal), ${worst.toFixed(2)} (channel sangat jarang)`);
  ok("estimasi realistis <=5 call/konten + ledger per brand/platform");
}
console.log(`ALL_PUBLISH_SWEEP_TESTS_PASS (${n} tes)`);
