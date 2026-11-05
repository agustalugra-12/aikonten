// Tes breaker PER TOKEN di cron auto-publish NYATA (fix/publish-breaker-per-token). Server GraphQL TIRUAN + DB
// sqlite TEMP (skema prod, tanpa data) - TIDAK menyentuh DB produksi / Buffer asli. npx tsx scripts/verify-publish-breaker.ts
// Cakup: (a) token A invalid + token B sehat di siklus SAMA -> B publish, A berhenti tepat saat trip;
// (b) 429 di token A -> sama; (c) kuota per brand & total tetap; (d) token terblokir 0 call Buffer lagi.
import assert from "node:assert";
import http from "node:http";
import Database from "better-sqlite3";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = join(tmpdir(), `kp-breaker-${process.pid}.db`);
const BAK = join(tmpdir(), `kp-breaker-${process.pid}.bak.db`);
for (const f of [TMP, TMP + "-wal", TMP + "-shm", BAK]) rmSync(f, { force: true });
const setup = new Database(TMP);
setup.exec(readFileSync(join(__dirname, "fixtures/prod-schema-2026-11-04.sql"), "utf8"));
setup.close();
const S = (ms: number) => Math.floor(ms / 1000);

// ---------- server GraphQL tiruan: hit dihitung PER TOKEN ----------
const hitsByTok: Record<string, number> = {};
const invalidTokens = new Set<string>();
const rateLimited = new Set<string>();
let seq = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const { query, variables } = JSON.parse(body || "{}");
    const tok = String(req.headers.authorization || "").replace("Bearer ", "");
    hitsByTok[tok] = (hitsByTok[tok] ?? 0) + 1;
    const send = (o: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (invalidTokens.has(tok)) return send({ errors: [{ message: "Access token is not valid", extensions: { code: "UNAUTHENTICATED" } }] });
    if (rateLimited.has(tok)) return send({ errors: [{ message: "Too many requests" }] }, 429);
    if (query.includes("organizations")) return send({ data: { account: { organizations: [{ id: "org1" }] } } });
    if (query.includes("createPost")) return send({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post-${++seq}`, status: "sent" } } } });
    if (query.includes("posts(")) return send({ data: { posts: { edges: [] } } });
    if (query.includes("post(")) return send({ data: { post: { id: variables?.input?.id, status: "sent" } } });
    send({ data: {} });
  });
});
let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    DATABASE_PATH: TMP, BUFFER_API_URL: `http://127.0.0.1:${port}`, BUFFER_ACCESS_TOKEN: "env-token",
    BUFFER_VERIFY_DELAYS_MS: "60,60", BUFFER_DUP_DELAYS_MS: "60", CRON_SECRET: "test-secret", OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-test",
    BUFFER_SWEEP_ENABLED: "1", // post sukses -> pending DB (tanpa polling verifikasi background yg ikut menambah hit)
  });
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.PUBLISH_MAX_PER_BRAND; delete process.env.PUBLISH_MAX_TOTAL;

  const { migratePublishLedger } = await import("./migrate-publish-ledger");
  await migratePublishLedger(TMP, BAK);
  const raw = new Database(TMP);
  const q = <T,>(sql: string, ...p: unknown[]) => raw.prepare(sql).all(...p) as T[];
  const { NextRequest } = await import("next/server");
  const { POST: autoPublish } = await import("@/app/api/cron/auto-publish/route");
  const { nowTimeStringWita } = await import("@/lib/ai/researchTopics");
  const { GATE_MESSAGES } = await import("@/lib/publish/publishGate");

  const t = Date.now();
  raw.exec(`INSERT INTO users (id,email,password_hash,created_at,unlimited,saldo_kredit) VALUES ('u1','t@x','h',${S(t)},1,7)`);
  const brand = (id: string, tok: string, auto = false) => {
    raw.prepare("INSERT INTO brands (id,user_id,name,created_at,publish_mode,auto_publish_times) VALUES (?,?,?,?,?,?)").run(id, "u1", `Brand ${id}`, S(t), auto ? "auto" : "draft", auto ? JSON.stringify([nowTimeStringWita()]) : null);
    raw.prepare("INSERT INTO social_accounts (id,brand_id,platform,publish_via,username,connected,created_at,buffer_channel_id,access_token) VALUES (?,?,?,?,?,?,?,?,?)").run(`acc_${id}`, id, "youtube", "buffer", `${id}_yt`, 1, S(t), `ch_${id}`, tok);
  };
  const project = (id: string, brandId: string, status: string, extra: { scheduledMs?: number; createdMs?: number; updatedMs?: number } = {}) => {
    raw.prepare("INSERT INTO projects (id,brand_id,type,status,generated_caption,scheduled_for,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, brandId, "video", status, `Judul ${id}\nisi`, extra.scheduledMs != null ? S(extra.scheduledMs) : null, S(extra.createdMs ?? t), S(extra.updatedMs ?? t));
    raw.prepare("INSERT INTO media_assets (id,project_id,type,file_url,created_at) VALUES (?,?,?,?,?)").run(`ma_${id}`, id, "final_video", `https://v/${id}.mp4`, S(t));
  };
  const retryProject = (id: string, brandId: string, createdMs: number) => {
    project(id, brandId, "failed", { createdMs, updatedMs: t - 3 * 3600_000 }); // backoff 2 jam lewat, usia < 72 jam
    raw.prepare("INSERT INTO publish_logs (id,project_id,social_account_id,status,error_message,created_at) VALUES (?,?,?,?,?,?)").run(`old_${id}`, id, `acc_${brandId}`, "failed", "Media timeout", S(t - 3 * 3600_000));
  };
  const st = (id: string) => q<{ status: string; error_message: string | null }>("SELECT status, error_message FROM projects WHERE id=?", id)[0];
  const ledgerCalls = (brandId: string) => q<{ c: number }>("SELECT COUNT(*) c FROM buffer_call_ledger WHERE brand_id=?", brandId)[0].c;
  const run = async () => {
    const r = await autoPublish(new NextRequest("http://x/api/cron/auto-publish", { method: "POST", headers: { "x-cron-key": "test-secret" } }));
    assert.strictEqual(r.status, 200);
    return await r.json() as { counts: { published: number; skipped_quota: number; skipped_gate: number; halted: string | null; breaker_trips: number }; results: Array<{ brandId: string; published: number; skipped?: string }> };
  };
  const creditTxBefore = q<{ c: number }>("SELECT COUNT(*) c FROM credit_transactions")[0].c;

  // ===== (a) token A INVALID: trip di fase RETRY; brand token B/C/T tetap publish di siklus SAMA =====
  invalidTokens.add("tok-A");
  brand("brA", "tok-A"); brand("brA2", "tok-A"); brand("brB", "tok-B"); brand("brC", "tok-C");
  brand("brS", "tok-A", true); brand("brT", "tok-T", true); // slot auto: S (token A) & T (token sehat)
  retryProject("rA", "brA", t - 1 * 3600_000);  // terbaru -> diproses PERTAMA -> trip token A
  retryProject("rA2", "brA2", t - 2 * 3600_000); // token A, brand lain -> harus dilewati (0 call)
  retryProject("rB", "brB", t - 3 * 3600_000);  // token B -> tetap retry
  project("a1", "brA", "scheduled", { scheduledMs: t - 60_000 });
  project("a2", "brA2", "scheduled", { scheduledMs: t - 60_000 });
  project("b1", "brB", "scheduled", { scheduledMs: t - 60_000 });
  project("b2", "brB", "scheduled", { scheduledMs: t - 60_000 }); // kuota 1/brand -> menunggu
  project("c1", "brC", "scheduled", { scheduledMs: t - 60_000 });
  project("s1", "brS", "ready"); project("t1", "brT", "ready");
  const body1 = await run();
  const callsA1 = hitsByTok["tok-A"] ?? 0;
  assert.ok(callsA1 >= 1, "token A dicoba sampai trip");
  assert.strictEqual(callsA1, ledgerCalls("brA"), "SEMUA call token A berasal dari 1 percobaan yg memicu trip (brand brA)");
  assert.strictEqual(ledgerCalls("brA2") + ledgerCalls("brS"), 0, "brand lain pemakai token A: 0 call Buffer setelah trip");
  assert.strictEqual(body1.counts.halted, "token_invalid"); assert.strictEqual(body1.counts.breaker_trips, 1, "1 token trip, siklus TIDAK dihentikan");
  assert.strictEqual(st("rB").status, "published", "retry token B tetap jalan setelah token A trip");
  assert.strictEqual(st("c1").status, "published", "scheduled token C tetap publish di siklus sama");
  assert.strictEqual(["b1", "b2"].filter((id) => st(id).status === "published").length, 1, "(c) kuota 1/brand/siklus tetap");
  assert.strictEqual(st("t1").status, "published", "slot auto token T tetap publish");
  for (const id of ["a1", "a2"]) {
    assert.strictEqual(st(id).status, "scheduled", `${id}: tetap scheduled (dicoba siklus berikut)`);
    assert.strictEqual(st(id).error_message, GATE_MESSAGES.token_cooldown, `${id}: alasan jelas token_cooldown`);
  }
  assert.strictEqual(st("rA2").status, "failed", "retry token A brand lain tak disentuh");
  assert.strictEqual(st("s1").status, "ready", "slot token A tak dipublish");
  assert.match(body1.results.find((r) => r.brandId === "brS")?.skipped ?? "", /^token_cooldown: /);
  assert.ok(body1.counts.skipped_gate >= 3, "a1, a2, rA2 tercatat skipped_gate");
  ok(`(a) token A invalid -> ${callsA1} call sampai trip lalu berhenti; token B/C/T publish di siklus SAMA (retry, scheduled, slot)`);

  // ===== (d) siklus berikut: token A masih cooldown -> 0 call =====
  const body2 = await run();
  assert.strictEqual(hitsByTok["tok-A"] ?? 0, callsA1, "(d) token A cooldown: TIDAK ada call Buffer lagi");
  assert.strictEqual(body2.counts.breaker_trips, 0);
  assert.strictEqual(["b1", "b2"].filter((id) => st(id).status === "published").length, 2, "b2 menetes di siklus berikut");
  ok("(d) token terblokir: 0 call Buffer di siklus berikut; brand sehat lanjut menetes");

  // ===== (b) 429 di token R: trip di fase SCHEDULED (dalam runPublishCycle) =====
  rateLimited.add("tok-R");
  brand("brR", "tok-R"); brand("brR2", "tok-R"); brand("brD", "tok-D");
  project("r1", "brR", "scheduled", { scheduledMs: t - 60_000 });
  project("r2", "brR2", "scheduled", { scheduledMs: t - 60_000 });
  project("d1", "brD", "scheduled", { scheduledMs: t - 60_000 });
  const body3 = await run();
  assert.strictEqual(hitsByTok["tok-R"] ?? 0, ledgerCalls("brR"), "call token R hanya dari percobaan r1 yg memicu trip");
  assert.ok((hitsByTok["tok-R"] ?? 0) >= 1);
  assert.strictEqual(ledgerCalls("brR2"), 0, "brR2 (token R) 0 call setelah 429");
  assert.strictEqual(body3.counts.halted, "rate_limit");
  assert.strictEqual(st("d1").status, "published", "token D tetap publish setelah 429 di token R");
  assert.strictEqual(st("r2").status, "scheduled"); assert.strictEqual(st("r2").error_message, GATE_MESSAGES.token_cooldown);
  assert.strictEqual(hitsByTok["tok-A"] ?? 0, callsA1, "token A tetap 0 call tambahan");
  ok("(b) 429 di token R -> hanya token R diblokir; token D publish di siklus sama; brR2 0 call");

  // ===== (c) cap TOTAL per siklus tetap (breaker tak membuka slot ekstra) =====
  process.env.PUBLISH_MAX_TOTAL = "2";
  invalidTokens.add("tok-G");
  brand("brG", "tok-G"); brand("brE", "tok-E"); brand("brF", "tok-F");
  project("g1", "brG", "scheduled", { scheduledMs: t - 60_000 });
  project("e1", "brE", "scheduled", { scheduledMs: t - 60_000 });
  project("f1", "brF", "scheduled", { scheduledMs: t - 60_000 });
  const body4 = await run();
  assert.strictEqual(st("e1").status, "published");
  assert.strictEqual(st("f1").status, "scheduled", "cap total 2 (g1+e1) -> f1 menunggu, tak menggantikan g1 yg trip");
  assert.strictEqual(ledgerCalls("brF"), 0);
  assert.strictEqual(body4.counts.skipped_quota, 1);
  delete process.env.PUBLISH_MAX_TOTAL;
  ok("(c) cap total per siklus tetap ditegakkan walau ada token yg trip");

  assert.strictEqual(q<{ saldo_kredit: number }>("SELECT saldo_kredit FROM users WHERE id='u1'")[0].saldo_kredit, 7, "kredit tak dipotong");
  assert.strictEqual(q<{ c: number }>("SELECT COUNT(*) c FROM credit_transactions")[0].c, creditTxBefore);
  ok("kredit TIDAK dipotong di semua siklus");

  raw.close(); server.close();
  for (const f of [TMP, TMP + "-wal", TMP + "-shm", BAK]) rmSync(f, { force: true });
  console.log(`ALL_PUBLISH_BREAKER_TESTS_PASS (${n} tes)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
