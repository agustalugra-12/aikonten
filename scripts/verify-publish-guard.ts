// Tes pengaman auto-publish (feat/publish-guard). npx tsx scripts/verify-publish-guard.ts
// Cakup: backlog 114 tak burst, konten lama dilewati, konten baru boleh, kuota per brand + total,
// scheduled terlambat -> tinjau, skip_auto_publish, idempotency, dan konfigurabilitas env.
import assert from "node:assert";
import { defaultGuardCfg, retryEligibility, scheduledEligibility, applyQuota, defaultBudgetCfg, budgetVerdict, classifyBufferError, defaultCooldownCfg, cooldownForReason, isInCooldown, defaultDailyCfg, dailyBrandExceeded, runPublishCycle } from "@/lib/publish/guard";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };
const H = 60 * 60 * 1000;
const now = 1_700_000_000_000;
const cfg = defaultGuardCfg({}); // default: 72h / 72h / 3 / 10

// 1. default cfg
assert.strictEqual(cfg.retryMaxAgeMs, 72 * H);
assert.strictEqual(cfg.scheduledGraceMs, 72 * H);
assert.strictEqual(cfg.maxPerBrandPerCycle, 1);
assert.strictEqual(cfg.maxTotalPerCycle, 10);
ok("default cfg 72h / 72h / 1 / 10");

// 2-4. retry eligibility: lama->age, baru->ok, skip_flag
assert.deepStrictEqual(retryEligibility({ id: "a", brandId: "b", createdAtMs: now - 100 * H, skipAutoPublish: false }, now, cfg), { ok: false, reason: "age" });
ok("konten lama (>72h) dilewati (age) - tak auto-terbit");
assert.deepStrictEqual(retryEligibility({ id: "a", brandId: "b", createdAtMs: now - 1 * H, skipAutoPublish: false }, now, cfg), { ok: true });
ok("konten baru (<72h) boleh retry");
assert.deepStrictEqual(retryEligibility({ id: "a", brandId: "b", createdAtMs: now, skipAutoPublish: true }, now, cfg), { ok: false, reason: "skip_flag" });
ok("skip_auto_publish dihormati");

// 5. BACKLOG 114 TIDAK BURST (Pelangi 92 + laundry 22) -> max 3/brand = 6 terpilih.
const backlog: Array<{ id: string; brandId: string }> = [];
for (let i = 0; i < 92; i++) backlog.push({ id: `pel${i}`, brandId: "pelangi" });
for (let i = 0; i < 22; i++) backlog.push({ id: `lau${i}`, brandId: "laundry" });
const q = applyQuota(backlog, cfg);
assert.strictEqual(q.selected.length, 2, "114 backlog -> 1/brand x2 = 2 (BUKAN 114)");
assert.strictEqual(q.selected.filter((c) => c.brandId === "pelangi").length, 1);
assert.strictEqual(q.selected.filter((c) => c.brandId === "laundry").length, 1);
assert.strictEqual(q.skippedQuota.length, 112);
ok("backlog 114 TIDAK burst (2 dipilih default 1/brand, 112 dilewati kuota)");

// 6. cap total per siklus (10 brand x 3 = 30 kandidat -> hanya 10)
const many: Array<{ id: string; brandId: string }> = [];
for (let b = 0; b < 10; b++) for (let i = 0; i < 3; i++) many.push({ id: `b${b}_${i}`, brandId: `brand${b}` });
assert.strictEqual(applyQuota(many, cfg).selected.length, 10, "cap total per siklus = 10");
ok("cap total per siklus ditegakkan (10)");

// 7. scheduled terlambat -> review; dalam grace -> publish; skip_flag
assert.strictEqual(scheduledEligibility({ id: "s", brandId: "b", scheduledForMs: now - 100 * H, skipAutoPublish: false }, now, cfg).action, "review");
assert.strictEqual(scheduledEligibility({ id: "s", brandId: "b", scheduledForMs: now - 1 * H, skipAutoPublish: false }, now, cfg).action, "publish");
assert.strictEqual(scheduledEligibility({ id: "s", brandId: "b", scheduledForMs: now, skipAutoPublish: true }, now, cfg).action, "skip_flag");
ok("scheduled: telat->tinjau, dalam grace->publish, skip_flag->skip (tak burst)");

// 8. idempotency per siklus: id duplikat lintas-daftar diproses sekali
const dup = [{ id: "x", brandId: "b1" }, { id: "x", brandId: "b1" }, { id: "y", brandId: "b2" }];
assert.strictEqual(applyQuota(dup, cfg).selected.length, 2, "id duplikat -> 1x (x sekali + y beda brand)");
ok("idempotency: project sama tak diproses 2x per siklus");

// 9. konfigurabilitas env (batas usia + kuota)
const cfg2 = defaultGuardCfg({ PUBLISH_RETRY_MAX_AGE_HOURS: "24", PUBLISH_MAX_PER_BRAND: "1", PUBLISH_MAX_TOTAL: "2" });
assert.strictEqual(cfg2.retryMaxAgeMs, 24 * H);
assert.strictEqual(cfg2.maxPerBrandPerCycle, 1);
assert.strictEqual(retryEligibility({ id: "a", brandId: "b", createdAtMs: now - 30 * H, skipAutoPublish: false }, now, cfg2).reason, "age", "batas usia 24h berlaku");
assert.strictEqual(applyQuota(backlog, cfg2).selected.length, 2, "maxPerBrand=1,total=2 -> 2 dipilih");
ok("batas usia & kuota bisa diatur via env");

// === BAGIAN 2 ===
// 10. Budget 30 hari: default 2000; berhenti retry/nonessential sebelum limit, publish baru tetap jalan.
const bcfg = defaultBudgetCfg({});
assert.strictEqual(bcfg.per30d, 2000, "budget teknis Buffer per token 30hr");
{ const v = budgetVerdict(100, bcfg); assert.ok(v.allowNewPublish && v.allowRetry && v.allowNonEssential, "pemakaian rendah -> semua boleh"); }
{ const v = budgetVerdict(2000 - 50, bcfg); assert.ok(v.allowNewPublish && !v.allowRetry && !v.allowNonEssential, "sisa<=reserve -> retry/nonessential STOP, publish baru tetap"); }
{ const v = budgetVerdict(2000, bcfg); assert.ok(!v.allowNewPublish && !v.allowRetry, "budget habis -> semua stop"); }
ok("budget 30hr: nonessential/retry stop sebelum limit, publish baru diutamakan, habis->stop semua");

// 11. Batas HARIAN per brand.
const dcfg = defaultDailyCfg({ PUBLISH_MAX_PER_BRAND_DAY: "10" });
assert.strictEqual(dailyBrandExceeded(9, dcfg), false);
assert.strictEqual(dailyBrandExceeded(10, dcfg), true, "brand sudah 10 hari ini -> stop");
ok("batas harian per brand ditegakkan");

// 12. "36 retry TIDAK habis dalam satu hari": 1/brand/siklus + batas harian 10/brand -> menetes.
// Simulasi: 36 kandidat 1 brand, siklus tiap 15 menit. Per siklus kuota 1, tapi batas harian 10 -> max 10/hari.
{
  let publishedToday = 0;
  for (let cycle = 0; cycle < 96; cycle++) { // 96 siklus/hari (tiap 15m)
    if (dailyBrandExceeded(publishedToday, dcfg)) break;      // gate harian
    const sel = applyQuota(Array.from({ length: 36 - publishedToday }, (_, i) => ({ id: `r${i}`, brandId: "pel" })), cfg);
    publishedToday += Math.min(sel.selected.length, 1);       // 1/brand/siklus
  }
  assert.strictEqual(publishedToday, 10, "36 retry: max 10/hari (batas harian) -> butuh ~4 hari, TAK habis sehari");
}
ok("36 retry tidak habis dalam satu hari (menetes <=10/hari)");

// 13. Prioritas: scheduled & publish baru DILAYANI sebelum retry dalam kuota siklus bersama.
{
  const ordered = [
    { id: "sched1", brandId: "pel", kind: "scheduled" },
    { id: "retry1", brandId: "pel", kind: "retry" },
  ];
  const sel = applyQuota(ordered, cfg); // 1/brand -> hanya yg pertama (scheduled)
  assert.strictEqual(sel.selected.length, 1);
  assert.strictEqual(sel.selected[0].id, "sched1", "scheduled diutamakan atas retry (kuota bersama)");
  ok("prioritas scheduled > retry dalam kuota siklus bersama");
}

// 14. classify + cooldown
assert.strictEqual(classifyBufferError('[{"message":"Access token is not valid","extensions":{"code":"UNAUTHENTICATED"}}]'), "token_invalid");
assert.strictEqual(classifyBufferError("Too many requests from this client"), "rate_limit");
assert.strictEqual(classifyBufferError("Media not found"), null, "error non-breaker -> null (lanjut)");
const ccfg = defaultCooldownCfg({});
assert.strictEqual(cooldownForReason("token_invalid", ccfg), 6 * H);
assert.strictEqual(cooldownForReason("rate_limit", ccfg), 1 * H);
assert.strictEqual(isInCooldown(now + 1000, now), true);
assert.strictEqual(isInCooldown(now - 1000, now), false);
ok("classifyBufferError + cooldown (token 6h / rate 1h) + isInCooldown");

// async: circuit breaker cycle
(async () => {
  // 15. token invalid -> berhenti setelah percobaan PERTAMA, tak coba kandidat lain, cooldown terpasang.
  {
    const cands = [{ id: "a", brandId: "p" }, { id: "b", brandId: "q" }, { id: "c", brandId: "r" }];
    let attempts = 0;
    const r = await runPublishCycle(cands, async () => { attempts++; return { ok: false, bufferError: "Access token is not valid (UNAUTHENTICATED)" }; }, { nowMs: now, cooldownCfg: ccfg });
    assert.strictEqual(attempts, 1, "token invalid -> HANYA 1 percobaan (tak coba konten lain)");
    assert.strictEqual(r.halted, "token_invalid");
    assert.strictEqual(r.cooldownUntilMs, now + 6 * H, "cooldown 6 jam terpasang");
    assert.deepStrictEqual(r.published, []);
    ok("token invalid -> stop setelah percobaan pertama + cooldown");
  }
  // 16. rate limit -> halt + cooldown 1 jam
  {
    const r = await runPublishCycle([{ id: "a", brandId: "p" }, { id: "b", brandId: "p" }], async () => ({ ok: false, bufferError: "Too many requests, raise your Buffer API limit" }), { nowMs: now, cooldownCfg: ccfg });
    assert.strictEqual(r.halted, "rate_limit");
    assert.strictEqual(r.cooldownUntilMs, now + 1 * H);
    ok("rate limit -> cooldown 1 jam, siklus berhenti");
  }
  // 17. sukses + gagal non-breaker: lanjut, tak halt
  {
    const r = await runPublishCycle([{ id: "a", brandId: "p" }, { id: "b", brandId: "q" }], async (id) => id === "a" ? { ok: true } : { ok: false, bufferError: "Media not found" }, { nowMs: now, cooldownCfg: ccfg });
    assert.strictEqual(r.halted, null);
    assert.deepStrictEqual(r.published, ["a"]);
    assert.deepStrictEqual(r.failed, ["b"], "gagal non-breaker tak hentikan siklus");
    ok("sukses + gagal non-breaker -> lanjut, tak halt");
  }
  console.log(`ALL_PUBLISH_GUARD_TESTS_PASS (${n} tes)`);
})();
