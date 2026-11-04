// Tes ledger Buffer + budget/cooldown persisten (feat/publish-guard). npx tsx scripts/verify-publish-ledger.ts
// ISOLASI: pakai DB sqlite TEMP (set DATABASE_PATH sebelum @/db dibuka) -> TIDAK menyentuh DB produksi.
// Cakup: log lama tak blokir, ledger catat semua jenis, isolasi token, cooldown persisten tahan restart, 20/bln.
import assert from "node:assert";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const TMP = join(tmpdir(), `kp-ledger-test-${process.pid}.db`);
process.env.DATABASE_PATH = TMP; // WAJIB sebelum import @/db (src/db/index.ts baca env saat load)
const setup = new Database(TMP);
setup.exec("CREATE TABLE buffer_call_ledger (id TEXT PRIMARY KEY, token_fp TEXT NOT NULL, brand_id TEXT, channel_id TEXT, kind TEXT NOT NULL, created_at INTEGER NOT NULL)");
setup.exec("CREATE TABLE buffer_token_state (token_fp TEXT PRIMARY KEY, cooldown_until INTEGER, reason TEXT, updated_at INTEGER NOT NULL)");
setup.close();

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
  const { tokenFingerprint, recordBufferCall, countCalls30d, getTokenCooldownUntil, setTokenCooldown } = await import("@/lib/publish/ledger");
  const guardMod = await import("@/lib/publish/guard");
  const { budgetVerdict, defaultBudgetCfg, isInCooldown } = guardMod;

  const now = 1_700_000_000_000; // kelipatan 1000 -> detik bersih (drizzle timestamp = detik)
  const TK_A = "token-brand-A", TK_B = "token-brand-B";

  // 1. fingerprint hash (tak bocor token mentah), stabil, beda token beda fp
  const fpA = tokenFingerprint(TK_A);
  assert.strictEqual(fpA.length, 16);
  assert.ok(!fpA.includes("token") && !fpA.includes("brand"), "fp tak memuat token mentah");
  assert.strictEqual(fpA, tokenFingerprint(TK_A));
  assert.notStrictEqual(fpA, tokenFingerprint(TK_B));
  ok("tokenFingerprint: hash 16 char, stabil, tak bocor token mentah");

  // 2. ledger catat SEMUA jenis call
  for (const k of ["createPost", "sweep", "analytics", "channels", "tokenCheck", "delete"] as const) await recordBufferCall(k, TK_A, "pelangi", "ch1", now);
  assert.strictEqual(await countCalls30d(TK_A, now), 6);
  ok("ledger mencatat SEMUA jenis call (createPost/sweep/analytics/channels/tokenCheck/delete)");

  // 3. isolasi token
  await recordBufferCall("createPost", TK_B, "laundry", "ch9", now);
  assert.strictEqual(await countCalls30d(TK_B, now), 1);
  assert.strictEqual(await countCalls30d(TK_A, now), 6, "token A tak terpengaruh B");
  ok("isolasi token: hitungan budget terpisah per token");

  // 4. log lama TIDAK memblokir publish token baru (budget dari ledger fresh)
  const bcfg = defaultBudgetCfg({});
  const used = await countCalls30d("token-baru-rotasi", now);
  assert.strictEqual(used, 0, "token baru: ledger kosong");
  assert.strictEqual(budgetVerdict(used, bcfg).allowNewPublish, true);
  ok("log lama tak memblokir publish token baru (budget via ledger, bukan publish_logs)");

  // 5. window 30 hari
  await recordBufferCall("createPost", TK_A, "pelangi", "ch1", now - 40 * 24 * 3600 * 1000);
  assert.strictEqual(await countCalls30d(TK_A, now), 6, "call 40 hari lalu di luar window");
  ok("window 30 hari: call lama tak dihitung");

  // 6. cooldown PERSISTEN + tahan restart + isolasi + kadaluarsa
  await setTokenCooldown(TK_A, now + 6 * 3600 * 1000, "token_invalid", now);
  assert.strictEqual(await getTokenCooldownUntil(TK_A, now), now + 6 * 3600 * 1000);
  assert.strictEqual(isInCooldown(await getTokenCooldownUntil(TK_A, now), now), true);
  // RESTART: handle DB BARU ke file sama -> cooldown masih ada (persisten, bukan in-memory)
  const restart = new Database(TMP);
  const row = restart.prepare("SELECT cooldown_until FROM buffer_token_state WHERE token_fp=?").get(tokenFingerprint(TK_A)) as { cooldown_until: number };
  restart.close();
  assert.strictEqual(row.cooldown_until, (now + 6 * 3600 * 1000) / 1000, "cooldown BERTAHAN setelah restart (tersimpan detik di DB)");
  assert.strictEqual(await getTokenCooldownUntil(TK_B, now), null, "cooldown isolasi: token B bebas");
  assert.strictEqual(await getTokenCooldownUntil(TK_A, now + 7 * 3600 * 1000), null, "cooldown kadaluarsa -> null");
  ok("cooldown/breaker per token PERSISTEN + tahan restart + isolasi + kadaluarsa");

  // 7. TIDAK ada kuota bulanan publish; PUBLISH_QUOTA_START_AT = baseline teknis (call sebelum titik mulai tak dihitung)
  assert.strictEqual("defaultMonthlyCfg" in guardMod || "monthlyBrandExceeded" in guardMod, false, "kuota bulanan publish dihapus");
  process.env.PUBLISH_QUOTA_START_AT = String(now + 1000); // aktivasi SETELAH 6 call di 'now'
  assert.strictEqual(await countCalls30d(TK_A, now + 2000), 0, "call sebelum PUBLISH_QUOTA_START_AT tak menghitung budget");
  await recordBufferCall("createPost", TK_A, "pelangi", "ch1", now + 1500);
  assert.strictEqual(await countCalls30d(TK_A, now + 2000), 1);
  delete process.env.PUBLISH_QUOTA_START_AT;
  ok("tanpa kuota bulanan; PUBLISH_QUOTA_START_AT = baseline teknis ledger");

  for (const s of ["", "-wal", "-shm"]) rmSync(TMP + s, { force: true });
  console.log(`ALL_PUBLISH_LEDGER_TESTS_PASS (${n} tes)`);
})();
