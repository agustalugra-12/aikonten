// Tes pengaman auto-publish (feat/publish-guard). npx tsx scripts/verify-publish-guard.ts
// Cakup: backlog 114 tak burst, konten lama dilewati, konten baru boleh, kuota per brand + total,
// scheduled terlambat -> tinjau, skip_auto_publish, idempotency, dan konfigurabilitas env.
import assert from "node:assert";
import { defaultGuardCfg, retryEligibility, scheduledEligibility, applyQuota } from "@/lib/publish/guard";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };
const H = 60 * 60 * 1000;
const now = 1_700_000_000_000;
const cfg = defaultGuardCfg({}); // default: 72h / 72h / 3 / 10

// 1. default cfg
assert.strictEqual(cfg.retryMaxAgeMs, 72 * H);
assert.strictEqual(cfg.scheduledGraceMs, 72 * H);
assert.strictEqual(cfg.maxPerBrandPerCycle, 3);
assert.strictEqual(cfg.maxTotalPerCycle, 10);
ok("default cfg 72h / 72h / 3 / 10");

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
assert.strictEqual(q.selected.length, 6, "114 backlog -> 3/brand x2 = 6 (BUKAN 114)");
assert.strictEqual(q.selected.filter((c) => c.brandId === "pelangi").length, 3);
assert.strictEqual(q.selected.filter((c) => c.brandId === "laundry").length, 3);
assert.strictEqual(q.skippedQuota.length, 108);
ok("backlog 114 TIDAK burst (6 dipilih, 108 dilewati kuota)");

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
const dup = [{ id: "x", brandId: "b" }, { id: "x", brandId: "b" }, { id: "y", brandId: "b" }];
assert.strictEqual(applyQuota(dup, cfg).selected.length, 2, "id duplikat -> 1x");
ok("idempotency: project sama tak diproses 2x per siklus");

// 9. konfigurabilitas env (batas usia + kuota)
const cfg2 = defaultGuardCfg({ PUBLISH_RETRY_MAX_AGE_HOURS: "24", PUBLISH_MAX_PER_BRAND: "1", PUBLISH_MAX_TOTAL: "2" });
assert.strictEqual(cfg2.retryMaxAgeMs, 24 * H);
assert.strictEqual(cfg2.maxPerBrandPerCycle, 1);
assert.strictEqual(retryEligibility({ id: "a", brandId: "b", createdAtMs: now - 30 * H, skipAutoPublish: false }, now, cfg2).reason, "age", "batas usia 24h berlaku");
assert.strictEqual(applyQuota(backlog, cfg2).selected.length, 2, "maxPerBrand=1,total=2 -> 2 dipilih");
ok("batas usia & kuota bisa diatur via env");

console.log(`ALL_PUBLISH_GUARD_TESTS_PASS (${n} tes)`);
