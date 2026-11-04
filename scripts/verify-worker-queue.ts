// Tes mock antrean worker (Tahap 3). Jalankan: npx tsx scripts/verify-worker-queue.ts
// Mock: worker hang, antrean penuh, fallback. Nol jaringan/VPS - murni logika helper workerQueue.ts.
import assert from "node:assert";
import { splitRenderBudget, runWithSlotTimeout, nextRetryDelayMs, isRetriable, TenantQuota } from "@/lib/render/workerQueue";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
// 1. WORKER HANG: render tak pernah resolve -> slot timeout -> abort + slot DILEPAS + reason "timeout".
{
  let released = 0;
  let aborted = false;
  const hang = (signal: AbortSignal) => new Promise<Buffer>(() => { signal.addEventListener("abort", () => { aborted = true; }); });
  const r = await runWithSlotTimeout(hang, 40, () => { released++; });
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as { reason: string }).reason, "timeout", "worker hang -> timeout");
  assert.strictEqual(released, 1, "slot DILEPAS tepat 1x (tak terus dipakai)");
  assert.strictEqual(aborted, true, "request di-abort");
  ok("worker hang -> timeout, slot dilepas (1x), request abort");
}
// 1b. Sukses sebelum timeout -> ok + slot tetap dilepas tepat 1x.
{
  let released = 0;
  const fast = async () => Buffer.from("mp4");
  const r = await runWithSlotTimeout(fast, 1000, () => { released++; });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(released, 1, "slot dilepas 1x di jalur sukses");
  ok("render sukses -> ok, slot dilepas 1x");
}

// 2. ANTREAN PENUH: kuota per-tenant + global. Penuh -> tolak (fallback), bukan antre tak terbatas.
{
  const q = new TenantQuota(1, 2); // 1 per tenant, 2 global
  assert.deepStrictEqual(q.tryAcquire("A"), { ok: true }, "A slot pertama");
  assert.deepStrictEqual(q.tryAcquire("A"), { ok: false, reason: "tenant_limit" }, "A kedua -> tenant_limit");
  assert.deepStrictEqual(q.tryAcquire("B"), { ok: true }, "B slot (global 2)");
  assert.deepStrictEqual(q.tryAcquire("C"), { ok: false, reason: "global_full" }, "C -> global_full");
  q.release("A");
  assert.deepStrictEqual(q.tryAcquire("C"), { ok: true }, "setelah A lepas, C dapat slot");
  assert.strictEqual(q.inFlight("A"), 0, "A nol in-flight setelah release");
  ok("antrean penuh -> tenant_limit/global_full; release buka slot");
}

// 3. FALLBACK: semua jalur tak-layak -> fallback ffmpeg.
{
  // 3a budget: antre sudah makan deadline -> proceed=false.
  const b1 = splitRenderBudget({ totalDeadlineMs: 28 * 60000, queueWaitedMs: 27 * 60000, minRenderMs: 3 * 60000 });
  assert.strictEqual(b1.proceed, false, "sisa < minRender -> jangan mulai (fallback)");
  const b2 = splitRenderBudget({ totalDeadlineMs: 28 * 60000, queueWaitedMs: 60000, minRenderMs: 3 * 60000 });
  assert.strictEqual(b2.proceed, true, "sisa cukup -> lanjut");
  assert.strictEqual(b2.renderDeadlineMs, 28 * 60000 - 60000, "deadline render = sisa (bukan 28min penuh)");
  // 3b retry habis -> null (fallback); transient boleh retry, timeout tidak.
  assert.strictEqual(nextRetryDelayMs(0, { maxAttempts: 2, baseMs: 1500, capMs: 8000 }), 1500, "retry#0=base");
  assert.strictEqual(nextRetryDelayMs(1, { maxAttempts: 2, baseMs: 1500, capMs: 8000 }), 3000, "retry#1=base*2");
  assert.strictEqual(nextRetryDelayMs(2, { maxAttempts: 2, baseMs: 1500, capMs: 8000 }), null, "habis -> null (fallback)");
  assert.strictEqual(nextRetryDelayMs(5, { maxAttempts: 9, baseMs: 1000, capMs: 8000 }), 8000, "backoff di-cap");
  assert.strictEqual(isRetriable("timeout", new Error("slot timeout")), false, "timeout TIDAK di-retry");
  assert.strictEqual(isRetriable("error", new Error("socket hang up")), true, "transient boleh retry");
  assert.strictEqual(isRetriable("error", new Error("Invalid HTML composition")), false, "error bukan-transient tak di-retry");
  ok("fallback: budget habis / retry habis / timeout-no-retry / transient-retry");
}

console.log(`ALL_WORKER_QUEUE_TESTS_PASS (${n} tes)`);
})();
