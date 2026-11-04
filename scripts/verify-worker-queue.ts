// Tes mock antrean worker (Tahap 3, rancangan ulang). npx tsx scripts/verify-worker-queue.ts
// Mock: worker hang->cancel, antre adil (fair), idempotency (anti render ganda), fallback. Nol jaringan/VPS.
import assert from "node:assert";
import { splitRenderBudget, estimateWaitMs, runWithSlotTimeout, nextRetryDelayMs, isRetriable, makeJobId, InFlightRegistry, FairScheduler } from "@/lib/render/workerQueue";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
// 1. WORKER HANG -> timeout BATALKAN worker (onTimeout=/cancel), bukan cuma abort client; slot lepas 1x.
{
  let cancelled = 0, settled = 0, aborted = false;
  const hang = (s: AbortSignal) => new Promise<Buffer>(() => { s.addEventListener("abort", () => { aborted = true; }); });
  const r = await runWithSlotTimeout(hang, 30, { onTimeout: () => { cancelled++; }, onSettle: () => { settled++; } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as { reason: string }).reason, "timeout");
  assert.strictEqual(cancelled, 1, "worker render DIBATALKAN (/cancel) saat timeout, bukan cuma client");
  assert.strictEqual(aborted, true, "request klien di-abort");
  assert.strictEqual(settled, 1, "slot dilepas tepat 1x");
  ok("worker hang -> timeout -> BATALKAN worker (/cancel) + slot lepas");
}
// 1b. Sukses sebelum timeout -> ok, onTimeout TIDAK dipanggil, slot lepas 1x.
{
  let cancelled = 0, settled = 0;
  const r = await runWithSlotTimeout(async () => Buffer.from("mp4"), 1000, { onTimeout: () => { cancelled++; }, onSettle: () => { settled++; } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(cancelled, 0, "sukses -> tak ada cancel");
  assert.strictEqual(settled, 1);
  ok("render sukses -> ok, tanpa cancel, slot lepas 1x");
}

// 2. IDEMPOTENCY (anti render ganda): jobId sama saat in-flight -> 1 render, hasil dibagi, auto-bersih.
{
  const reg = new InFlightRegistry<string>();
  let starts = 0;
  const slow = () => new Promise<string>((res) => setTimeout(() => res("mp4"), 20));
  const a = reg.run("job1", () => { starts++; return slow(); });
  const b = reg.run("job1", () => { starts++; return slow(); });
  assert.strictEqual(a.deduped, false, "submit pertama -> jalan");
  assert.strictEqual(b.deduped, true, "submit kedua jobId sama -> DEDUP (tak render ganda)");
  assert.strictEqual(reg.size(), 1);
  const [v1, v2] = await Promise.all([a.promise, b.promise]);
  assert.strictEqual(starts, 1, "render di-start SEKALI saja (retry tak picu render kedua)");
  assert.strictEqual(v1, v2, "kedua pemanggil dapat hasil sama");
  assert.strictEqual(reg.has("job1"), false, "dibersihkan setelah selesai");
  assert.strictEqual(makeJobId("t", "p", "h"), "t:p:h", "jobId deterministik dari konten");
  ok("idempotency: jobId sama -> 1 render, hasil dibagi, auto-bersih");
}

// 3. KUOTA ADIL (antre, bukan fallback): round-robin lintas tenant; job MENUNGGU giliran, tak ditolak.
{
  const sch = new FairScheduler(1); // 1 render sekali waktu (serial, cocok worker)
  const started: string[] = [];
  const res: Array<() => void> = [];
  const run = (label: string) => sch.schedule(label[0], () => new Promise<void>((r) => { started.push(label); res.push(r); }));
  const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // beri kesempatan pump() jalan stlh selesai
  run("A1"); run("A2"); run("A3"); run("B1");
  await tick();
  assert.deepStrictEqual(started, ["A1"], "maxConcurrent=1 -> hanya A1 jalan");
  assert.strictEqual(sch.waitingCount(), 3, "3 job MENUNGGU (antre, bukan ditolak/fallback)");
  res.shift()!(); await tick();
  assert.deepStrictEqual(started, ["A1", "B1"], "round-robin ADIL: B sebelum A2 (A tak memonopoli)");
  res.shift()!(); await tick();
  assert.deepStrictEqual(started, ["A1", "B1", "A2"]);
  res.shift()!(); await tick();
  assert.deepStrictEqual(started, ["A1", "B1", "A2", "A3"], "urutan adil A1,B1,A2,A3 (bukan FIFO A,A,A,B)");
  res.shift()!(); await tick();
  assert.strictEqual(sch.waitingCount(), 0);
  ok("kuota adil: round-robin antre A1,B1,A2,A3 (anti-monopoli, bukan langsung fallback)");
}

// 4. FALLBACK: budget habis / estimasi tunggu > budget / retry habis. (fallback hanya saat tak layak antre)
{
  assert.strictEqual(splitRenderBudget({ totalDeadlineMs: 28 * 60000, queueWaitedMs: 27 * 60000, minRenderMs: 3 * 60000 }).proceed, false, "antre makan deadline -> fallback");
  const b2 = splitRenderBudget({ totalDeadlineMs: 28 * 60000, queueWaitedMs: 60000, minRenderMs: 3 * 60000 });
  assert.strictEqual(b2.proceed, true);
  assert.strictEqual(b2.renderDeadlineMs, 28 * 60000 - 60000, "deadline render = sisa (bukan 28min penuh)");
  // estimasi tunggu DIKETAHUI dari posisi antre -> pemanggil fallback kalau > budget.
  const wait = estimateWaitMs({ aheadInQueue: 5, running: 1, maxConcurrent: 1, avgRenderMs: 4 * 60000 });
  assert.strictEqual(wait, 5 * 4 * 60000, "estimasi tunggu = batch di depan * durasi (waktu antre diketahui)");
  assert.strictEqual(nextRetryDelayMs(0, { maxAttempts: 2, baseMs: 1500, capMs: 8000 }), 1500);
  assert.strictEqual(nextRetryDelayMs(2, { maxAttempts: 2, baseMs: 1500, capMs: 8000 }), null, "retry habis -> fallback");
  assert.strictEqual(isRetriable("timeout", new Error("slot timeout")), false, "timeout TIDAK di-retry (anti render ganda mahal)");
  assert.strictEqual(isRetriable("error", new Error("socket hang up")), true, "transient boleh retry");
  ok("fallback: budget/estimasi-tunggu/retry-habis; timeout no-retry");
}

console.log(`ALL_WORKER_QUEUE_TESTS_PASS (${n} tes)`);
})();
