// Tes E2E publish-guard dgn SERVER GRAPHQL TIRUAN + DB sqlite TEMP (skema prod, tanpa data). TIDAK menyentuh
// DB produksi / Buffer asli. npx tsx scripts/verify-publish-e2e.ts
// Cakup: migrasi berurutan (tabel hilang -> publish berhenti jelas; migrate idempoten), flag OFF = jalur lama,
// flag ON = sweep (verifikasi + duplikat), pending tahan restart, ledger semua jenis, kuota & cooldown per token,
// dan tidak ada post Buffer sukses yang kehilangan verifikasi.
import assert from "node:assert";
import http from "node:http";
import Database from "better-sqlite3";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = join(tmpdir(), `kp-e2e-${process.pid}.db`);
const BAK = join(tmpdir(), `kp-e2e-${process.pid}.bak.db`);
for (const f of [TMP, TMP + "-wal", TMP + "-shm", BAK]) rmSync(f, { force: true });
const setup = new Database(TMP);
setup.exec(readFileSync(join(__dirname, "fixtures/prod-schema-2026-11-04.sql"), "utf8")); // skema prod, TANPA tabel ledger
const S = (ms: number) => Math.floor(ms / 1000); // drizzle timestamp = detik
const NOW = Date.now();
setup.exec(`INSERT INTO users (id,email,password_hash,created_at) VALUES ('u1','t@x','h',${S(NOW)})`);
setup.exec(`INSERT INTO brands (id,user_id,name,created_at) VALUES ('brA','u1','Brand A',${S(NOW)}),('brB','u1','Brand B',${S(NOW)}),('brC','u1','Brand C',${S(NOW)})`);
setup.exec(`INSERT INTO social_accounts (id,brand_id,platform,publish_via,username,connected,created_at,buffer_channel_id,access_token) VALUES
  ('accA','brA','tiktok','buffer','a_tt',1,${S(NOW)},'chA',NULL),
  ('accAig','brA','instagram','buffer','a_ig',1,${S(NOW)},'chAig',NULL),
  ('accB','brB','tiktok','buffer','b_tt',1,${S(NOW)},'chB','tok-B'),
  ('accC','brC','tiktok','buffer','c_tt',1,${S(NOW)},'chC','tok-C')`);
setup.exec(`INSERT INTO projects (id,brand_id,type,status,created_at,updated_at) VALUES ('pReady','brA','video','ready',${S(NOW)},${S(NOW)})`);
setup.close();

// ---------- server GraphQL tiruan ----------
type FakePost = { id: string; text: string; status: string; externalLink: string; channelId: string };
const posts: FakePost[] = [];
const hits: Record<string, number> = {};
const deleted: string[] = [];
const invalidTokens = new Set<string>();
let nextCreateStatus = "sending";
let makeDupOnCreate = false;
let seq = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const { query, variables } = JSON.parse(body || "{}");
    const tok = String(req.headers.authorization || "").replace("Bearer ", "");
    const send = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const kind = query.includes("createPost") ? "createPost" : query.includes("deletePost") ? "deletePost" : query.includes("posts(") ? "posts"
      : query.includes("post(") ? "post" : query.includes("organizations") ? "org" : query.includes("channels(") ? "channels" : query.includes("aggregatedPostMetrics") ? "agg" : "other";
    hits[kind] = (hits[kind] ?? 0) + 1;
    if (invalidTokens.has(tok)) return send({ errors: [{ message: "Access token is not valid", extensions: { code: "UNAUTHENTICATED" } }] });
    const inp = variables?.input ?? {};
    if (kind === "org") return send({ data: { account: { organizations: [{ id: "org1" }] } } });
    if (kind === "createPost") {
      const id = `post-${++seq}`;
      posts.push({ id, text: inp.text, status: nextCreateStatus, externalLink: `https://x/${id}`, channelId: inp.channelId });
      if (makeDupOnCreate) posts.push({ id: `dup-${seq}`, text: inp.text, status: "sent", externalLink: `https://x/dup-${seq}`, channelId: inp.channelId });
      return send({ data: { createPost: { __typename: "PostActionSuccess", post: { id, status: nextCreateStatus } } } });
    }
    if (kind === "deletePost") { const i = posts.findIndex((p) => p.id === inp.id); if (i >= 0) posts.splice(i, 1); deleted.push(inp.id); return send({ data: { deletePost: { __typename: "DeletePostSuccess" } } }); }
    if (kind === "posts") { const ch = inp.filter?.channelIds?.[0]; return send({ data: { posts: { edges: posts.filter((p) => p.channelId === ch).map((p) => ({ node: p })) } } }); }
    if (kind === "post") { const p = posts.find((x) => x.id === inp.id); return send({ data: { post: p ? { id: p.id, status: p.status } : null } }); }
    if (kind === "channels") return send({ data: { channels: [{ id: "chA", name: "A", service: "tiktok" }] } });
    if (kind === "agg") return send({ data: { aggregatedPostMetrics: { metrics: [{ name: "views", value: 5, unit: "", type: "views" }] } } });
    send({ data: {} });
  });
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    DATABASE_PATH: TMP, BUFFER_API_URL: `http://127.0.0.1:${port}`, BUFFER_ACCESS_TOKEN: "env-token-A",
    BUFFER_VERIFY_DELAYS_MS: "60,60", BUFFER_DUP_DELAYS_MS: "60", CRON_SECRET: "test-secret", OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-test",
  });
  delete process.env.BUFFER_SWEEP_ENABLED;
  delete process.env.TELEGRAM_BOT_TOKEN;

  const ledger = await import("@/lib/publish/ledger");
  const { migratePublishLedger } = await import("./migrate-publish-ledger");
  const raw = new Database(TMP);
  const q = <T,>(sql: string, ...p: unknown[]) => raw.prepare(sql).all(...p) as T[];

  // ===== 1. MIGRASI BERURUTAN: tabel belum ada -> publish & cron BERHENTI JELAS (bukan budget=0) =====
  assert.strictEqual(ledger.ledgerReady(), false);
  assert.throws(() => ledger.assertLedgerReady(), /LEDGER_NOT_MIGRATED/);
  const { publishProject } = await import("@/lib/publish/orchestrate");
  await assert.rejects(publishProject("pReady"), /LEDGER_NOT_MIGRATED/);
  assert.strictEqual(q<{ status: string }>("SELECT status FROM projects WHERE id='pReady'")[0].status, "ready", "status project TIDAK disentuh");
  const { NextRequest } = await import("next/server");
  const { POST: autoPublish } = await import("@/app/api/cron/auto-publish/route");
  const r503 = await autoPublish(new NextRequest("http://x/api/cron/auto-publish", { method: "POST", headers: { "x-cron-key": "test-secret" } }));
  assert.strictEqual(r503.status, 503);
  assert.match(JSON.stringify(await r503.json()), /LEDGER_NOT_MIGRATED/);
  ok("tabel ledger belum ada -> publishProject & cron auto-publish berhenti JELAS (503 LEDGER_NOT_MIGRATED), status project utuh");

  const m1 = await migratePublishLedger(TMP, BAK);
  assert.deepStrictEqual(m1.before, []); assert.strictEqual(m1.after.length, 3);
  assert.ok(existsSync(BAK), "backup dibuat SEBELUM migrasi");
  assert.strictEqual((new Database(BAK, { readonly: true }).prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='buffer_call_ledger'").get() as { c: number }).c, 0, "backup = kondisi pra-migrasi");
  const m2 = await migratePublishLedger(TMP, BAK + "2");
  assert.deepStrictEqual(m2.before, m2.after, "migrasi ulang idempoten (no-op)");
  assert.strictEqual(ledger.ledgerReady(), true);
  ok("migrate: backup dulu -> DDL atomik -> verifikasi; ulang = idempoten; ledgerReady=true");

  const { publishViaBuffer } = await import("@/lib/publish/buffer");
  const { afterBufferPublish, runPublishSweep } = await import("@/lib/publish/sweepRunner");
  const seedLog = (id: string, project: string, acc: string, postId: string) => {
    raw.prepare("INSERT INTO projects (id,brand_id,type,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(project, acc === "accB" ? "brB" : "brA", "video", "published", S(NOW), S(NOW));
    raw.prepare("INSERT INTO publish_logs (id,project_id,social_account_id,status,platform_post_id,created_at) VALUES (?,?,?,?,?,?)").run(id, project, acc, "success", postId, S(NOW));
  };
  const after = (logId: string, project: string, platform: string, channelId: string, postId: string, text: string, acc = "accA") =>
    afterBufferPublish({ publishLogId: logId, projectId: project, socialAccountId: acc, brandId: "brA", brandName: "Brand A", platform, platformLabel: platform, channelId, token: null, platformPostId: postId, postText: text });

  // ===== 2. FLAG OFF = JALUR LAMA PERSIS =====
  makeDupOnCreate = true; nextCreateStatus = "sending";
  const off = await publishViaBuffer({ videoUrl: "https://v/1.mp4", caption: "Halo OFF", accessToken: null, accountUsername: "a_tt", platformAccountId: null, bufferChannelId: "chA", platform: "tiktok", brandName: "Brand A", brandId: "brA" });
  assert.ok(off.success && off.platformPostId);
  seedLog("logOff", "pOff", "accA", off.platformPostId!);
  posts.find((p) => p.id === off.platformPostId)!.status = "error"; // Buffer akhirnya gagal
  const modeOff = await after("logOff", "pOff", "tiktok", "chA", off.platformPostId!, "Halo OFF");
  assert.strictEqual(modeOff, "legacy_verify");
  assert.strictEqual(await after("logIg", "pOff", "instagram", "chAig", "post-ig", "x"), "legacy_skip_platform", "Instagram tetap skip verify (persis lama)");
  await sleep(1500);
  assert.ok((hits.posts ?? 0) >= 1, "OFF: cek duplikat per-post jalan");
  assert.ok(deleted.some((d) => d.startsWith("dup-")), "OFF: duplikat dihapus jalur lama");
  assert.strictEqual(q<{ status: string }>("SELECT status FROM publish_logs WHERE id='logOff'")[0].status, "failed", "OFF: verifikasi lama koreksi status error");
  assert.strictEqual(q<{ c: number }>("SELECT COUNT(*) c FROM buffer_pending_checks")[0].c, 0, "OFF: tak ada pending sweep");
  const offSweep = await runPublishSweep({ notify: async () => {} });
  assert.strictEqual(offSweep.enabled, false); assert.strictEqual(offSweep.bufferCalls, 0, "OFF: sweep no-op, 0 call");
  ok("flag OFF: cek duplikat per-post + verifikasi lama (skip IG) jalan persis; tanpa pending; sweep no-op");

  // ===== 3. FLAG ON = SWEEP (verifikasi + duplikat), verifikasi lama TIDAK dipanggil =====
  process.env.BUFFER_SWEEP_ENABLED = "1";
  const postsBefore = hits.posts ?? 0; const verifyBefore = hits.post ?? 0;
  const on1 = await publishViaBuffer({ videoUrl: "https://v/2.mp4", caption: "Halo ON 1", accessToken: null, accountUsername: "a_tt", platformAccountId: null, bufferChannelId: "chA", platform: "tiktok", brandName: "Brand A", brandId: "brA" });
  makeDupOnCreate = false;
  const on2 = await publishViaBuffer({ videoUrl: "https://v/3.mp4", caption: "Halo ON 2", accessToken: null, accountUsername: "a_tt", platformAccountId: null, bufferChannelId: "chA", platform: "tiktok", brandName: "Brand A", brandId: "brA" });
  const on3 = await publishViaBuffer({ videoUrl: "https://v/4.mp4", caption: "Halo ON 3 IG", accessToken: null, accountUsername: "a_ig", platformAccountId: null, bufferChannelId: "chAig", platform: "instagram", brandName: "Brand A", brandId: "brA" });
  seedLog("logOn1", "pOn1", "accA", on1.platformPostId!); seedLog("logOn2", "pOn2", "accA", on2.platformPostId!); seedLog("logOn3", "pOn3", "accAig", on3.platformPostId!);
  assert.strictEqual(await after("logOn1", "pOn1", "tiktok", "chA", on1.platformPostId!, "Halo ON 1"), "sweep_pending");
  assert.strictEqual(await after("logOn2", "pOn2", "tiktok", "chA", on2.platformPostId!, "Halo ON 2"), "sweep_pending");
  assert.strictEqual(await after("logOn3", "pOn3", "instagram", "chAig", on3.platformPostId!, "Halo ON 3 IG", "accAig"), "sweep_pending");
  await sleep(1500);
  assert.strictEqual(hits.posts ?? 0, postsBefore, "ON: cek duplikat per-post TIDAK jalan");
  assert.strictEqual(hits.post ?? 0, verifyBefore, "ON: verifikasi lama TIDAK jalan");
  ok("flag ON: post Buffer sukses -> pending di DB (termasuk IG); polling lama per-post tidak dipanggil");

  // ===== 4. RESTART: pending persisten; sweep proses setelah 'restart' =====
  const restart = new Database(TMP, { readonly: true });
  assert.strictEqual((restart.prepare("SELECT COUNT(*) c FROM buffer_pending_checks WHERE done_at IS NULL").get() as { c: number }).c, 3);
  restart.close();
  posts.find((p) => p.id === on1.platformPostId)!.status = "sent";
  posts.find((p) => p.id === on2.platformPostId)!.status = "error";
  posts.find((p) => p.id === on3.platformPostId)!.status = "sent";
  const notes: string[] = [];
  const postsHitsBefore = hits.posts ?? 0;
  const sw = await runPublishSweep({ nowMs: Date.now() + 6 * 60_000, notify: async (m) => { notes.push(m); } });
  assert.strictEqual(sw.channelsSwept, 2, "2 channel ber-pending -> 2 sweep");
  assert.strictEqual((hits.posts ?? 0) - postsHitsBefore, 2, "TEPAT 1 query posts per channel");
  assert.strictEqual(sw.confirmed, 2); assert.strictEqual(sw.errored, 1);
  assert.strictEqual(sw.duplicatesFound, 1); assert.strictEqual(sw.duplicatesDeleted, 1);
  assert.ok(deleted.includes(`dup-${on1.platformPostId!.split("-")[1]}`), "duplikat dihapus by id (bukan post kita)");
  assert.ok(posts.some((p) => p.id === on1.platformPostId), "post asli kita TIDAK dihapus");
  assert.strictEqual(q<{ status: string }>("SELECT status FROM publish_logs WHERE id='logOn2'")[0].status, "failed", "error -> publish_log dikoreksi");
  assert.strictEqual(q<{ status: string }>("SELECT status FROM projects WHERE id='pOn2'")[0].status, "failed", "status project dihitung ulang");
  assert.ok(notes.some((x) => x.includes("duplikat")) && notes.some((x) => x.includes("KOREKSI")), "notifikasi duplikat & error tidak hilang");
  assert.strictEqual(q<{ c: number }>("SELECT COUNT(*) c FROM buffer_pending_checks WHERE done_at IS NULL")[0].c, 0, "semua pending selesai -> tak ada post tanpa verifikasi");
  ok("sweep (pending dari DB, pasca-restart): sukses/error/duplikat ditangani, 1 query per channel, notif utuh, 0 pending tersisa");

  // pending lama yg 'nyangkut' (tak pernah sent) juga dikoreksi -> tak ada yg lolos verifikasi
  raw.prepare("INSERT INTO buffer_pending_checks (id,publish_log_id,project_id,social_account_id,brand_id,channel_id,token_fp,platform,platform_post_id,post_text,dup_handled,created_at) VALUES ('bpcOld','logOn1','pOn1','accA','brA','chA',?, 'tiktok','post-hilang','x',0,?)").run(ledger.tokenFingerprint(null), S(NOW - 60 * 60_000));
  const sw2 = await runPublishSweep({ notify: async () => {} });
  assert.strictEqual(sw2.stuck, 1, "pending > 20 menit tak ditemukan -> stuck -> dikoreksi + notif");
  // dry-run read-only: tak ubah apa pun, tak delete
  raw.prepare("INSERT INTO buffer_pending_checks (id,publish_log_id,project_id,social_account_id,brand_id,channel_id,token_fp,platform,platform_post_id,post_text,dup_handled,created_at) VALUES ('bpcDry','logOn1','pOn1','accA','brA','chA',?, 'tiktok',?,'Halo ON 1',0,?)").run(ledger.tokenFingerprint(null), on1.platformPostId, S(NOW));
  posts.push({ id: "dup-dry", text: "Halo ON 1", status: "sent", externalLink: "x", channelId: "chA" });
  const delBefore = deleted.length;
  const dry = await runPublishSweep({ dryRun: true, notify: async () => { throw new Error("dry-run tak boleh notif"); } });
  assert.strictEqual(dry.duplicatesFound, 1); assert.strictEqual(deleted.length, delBefore, "dry-run TIDAK delete");
  assert.strictEqual(q<{ c: number }>("SELECT COUNT(*) c FROM buffer_pending_checks WHERE id='bpcDry' AND done_at IS NULL")[0].c, 1, "dry-run tak ubah pending");
  raw.prepare("UPDATE buffer_pending_checks SET done_at=? WHERE id='bpcDry'").run(S(NOW));
  ok("pending nyangkut dikoreksi; mode dry-run read-only (tanpa delete/notif/ubah DB)");

  // ===== 5. LEDGER mencatat SEMUA jenis call =====
  const { listBufferChannels, getAggregatedMetrics } = await import("@/lib/publish/bufferAuth");
  await listBufferChannels(null); await getAggregatedMetrics("chA", "2026-01-01", "2026-01-02", null, { brandId: "brA" });
  const kinds = q<{ kind: string }>("SELECT DISTINCT kind FROM buffer_call_ledger").map((r) => r.kind).sort();
  assert.deepStrictEqual(kinds, ["analytics", "channels", "createPost", "delete", "duplicateCheck", "sweep", "tokenCheck", "verify"]);
  const ledgerTotal = q<{ c: number }>("SELECT COUNT(*) c FROM buffer_call_ledger")[0].c;
  const serverTotal = Object.values(hits).reduce((a, b) => a + b, 0);
  assert.strictEqual(ledgerTotal, serverTotal, `ledger (${ledgerTotal}) == call yg diterima server (${serverTotal})`);
  assert.ok(q<{ c: number }>("SELECT COUNT(*) c FROM buffer_call_ledger WHERE token_fp=? AND brand_id='brA' AND kind='createPost'", ledger.tokenFingerprint(null))[0].c >= 4, "createPost tercatat per token+brand");
  ok(`ledger mencatat 8 jenis call; total ledger = total call nyata (${ledgerTotal})`);

  // ===== 6. KUOTA & COOLDOWN PER TOKEN =====
  const { evaluateBrandGate, tripBreakerForProject } = await import("@/lib/publish/publishGate");
  const { defaultCooldownCfg } = await import("@/lib/publish/guard");
  const t = Date.now();
  // budget per token: tok-C 1900 call -> retry stop (reserve), publish baru boleh; 2000 -> semua stop
  const ins = raw.prepare("INSERT INTO buffer_call_ledger (id,token_fp,brand_id,channel_id,kind,created_at) VALUES (?,?,?,?,?,?)");
  raw.transaction(() => { for (let i = 0; i < 1900; i++) ins.run(`c${i}`, ledger.tokenFingerprint("tok-C"), "brC", "chC", "createPost", S(t)); })();
  let gC = await evaluateBrandGate("brC", t);
  assert.ok(gC.allowNew && !gC.allowRetry && gC.reason === "token_budget_reserve", "1900/2000: retry stop, publish baru jalan");
  raw.transaction(() => { for (let i = 1900; i < 2000; i++) ins.run(`c${i}`, ledger.tokenFingerprint("tok-C"), "brC", "chC", "createPost", S(t)); })();
  gC = await evaluateBrandGate("brC", t);
  assert.ok(!gC.allowNew && gC.reason === "token_budget_exhausted", "2000/2000: semua stop SEBELUM lewat limit");
  assert.ok((await evaluateBrandGate("brB", t)).allowNew, "isolasi: token B tak terpengaruh budget token C");
  // breaker -> cooldown persisten HANYA token akun yg gagal
  raw.prepare("INSERT INTO projects (id,brand_id,type,status,created_at,updated_at) VALUES ('pB','brB','video','failed',?,?)").run(S(t), S(t));
  raw.prepare("INSERT INTO publish_logs (id,project_id,social_account_id,status,error_message,created_at) VALUES ('lB','pB','accB','failed','Access token is not valid',?)").run(S(t));
  const fp = await tripBreakerForProject("pB", "token_invalid", t, defaultCooldownCfg());
  assert.strictEqual(fp, ledger.tokenFingerprint("tok-B"));
  const gB = await evaluateBrandGate("brB", t);
  assert.ok(!gB.allowNew && gB.reason === "token_cooldown", "token B cooldown");
  assert.notStrictEqual((await evaluateBrandGate("brA", t)).reason, "token_cooldown", "brand A (token lain) tak kena cooldown");
  const rr = new Database(TMP, { readonly: true });
  assert.ok((rr.prepare("SELECT cooldown_until FROM buffer_token_state WHERE token_fp=?").get(fp) as { cooldown_until: number }).cooldown_until > S(t), "cooldown tersimpan di DB (tahan restart)");
  rr.close();
  assert.match(gC.message!, /budget teknis Buffer/); assert.match(gC.message!, /Bukan kuota paket; kredit tidak dipotong/);
  raw.prepare("DELETE FROM buffer_call_ledger WHERE token_fp=?").run(ledger.tokenFingerprint("tok-C"));
  const seedPublished = (brand: string, acc: string, nItems: number, atMs: number, pfx: string) => raw.transaction(() => {
    for (let i = 0; i < nItems; i++) {
      raw.prepare("INSERT INTO projects (id,brand_id,type,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(`${pfx}${i}`, brand, "video", "published", S(atMs), S(atMs));
      raw.prepare("INSERT INTO publish_logs (id,project_id,social_account_id,status,created_at) VALUES (?,?,?,?,?)").run(`l${pfx}${i}`, `${pfx}${i}`, acc, "success", S(atMs));
    }
  })();
  // EKSTERNAL (owner bukan unlimited): 25 publish hari ini + 60 bulan ini -> TETAP boleh (tak ada kuota harian/bulanan)
  seedPublished("brC", "accC", 25, t - 3600_000, "ext"); seedPublished("brC", "accC", 60, t - 10 * 24 * 3600_000, "extm");
  gC = await evaluateBrandGate("brC", t);
  assert.ok(gC.allowNew && gC.allowRetry && !gC.internal && gC.publishedToday === null, "eksternal: tanpa kuota harian/bulanan");
  // INTERNAL (owner unlimited, ditentukan dari akun owner, bukan nama brand): 20/hari
  raw.exec(`INSERT INTO users (id,email,password_hash,created_at,unlimited) VALUES ('uI','i@x','h',${S(t)},1)`);
  raw.exec(`INSERT INTO brands (id,user_id,name,created_at) VALUES ('brI','uI','Pelangi Homestay KLON',${S(t)})`);
  raw.exec(`INSERT INTO social_accounts (id,brand_id,platform,publish_via,username,connected,created_at,buffer_channel_id,access_token) VALUES ('accI','brI','tiktok','buffer','i_tt',1,${S(t)},'chI','tok-I')`);
  seedPublished("brI", "accI", 19, t - 2 * 3600_000, "int");
  let gI = await evaluateBrandGate("brI", t);
  assert.ok(gI.internal && gI.allowNew && gI.publishedToday === 19, "internal 19/20 -> boleh");
  seedPublished("brI", "accI", 1, t - 2 * 3600_000, "int20");
  gI = await evaluateBrandGate("brI", t);
  assert.ok(!gI.allowNew && gI.reason === "internal_daily_quota" && gI.publishedToday === 20, "internal 20/hari -> ditahan");
  // brand bernama "Pelangi" tapi owner eksternal -> TETAP eksternal (tak hardcode nama)
  raw.exec(`INSERT INTO brands (id,user_id,name,created_at) VALUES ('brP','u1','Pelangi Homestay',${S(t)})`);
  assert.strictEqual((await evaluateBrandGate("brP", t)).internal, false, "internal/eksternal dari owner, bukan nama brand");
  // PUBLISH_QUOTA_START_AT: publish sebelum titik mulai tak dihitung kuota harian internal
  process.env.PUBLISH_QUOTA_START_AT = new Date(t - 3600_000).toISOString();
  assert.ok((await evaluateBrandGate("brI", t)).allowNew, "baseline: 20 publish sebelum START_AT tak dihitung");
  delete process.env.PUBLISH_QUOTA_START_AT;
  ok("budget token (reserve 1900 / habis 2000, pesan teknis bukan kuota paket), isolasi, cooldown persisten per token, eksternal tanpa kuota harian/bulanan, internal 20/hari dari owner, baseline START_AT");

  // ===== 7. Route sweep: flag OFF -> no-op; dryRun boleh =====
  const { POST: sweepRoute } = await import("@/app/api/cron/publish-sweep/route");
  delete process.env.BUFFER_SWEEP_ENABLED;
  const so = await sweepRoute(new NextRequest("http://x/api/cron/publish-sweep", { method: "POST", headers: { "x-cron-key": "test-secret" } }));
  assert.match(JSON.stringify(await so.json()), /BUFFER_SWEEP_ENABLED off/);
  ok("cron publish-sweep: flag OFF -> no-op (verifikasi lama aktif)");

  // ===== 8. CRON NYATA: kredit tak terpotong, anti-burst, token sehat jalan, token habis ditahan jelas =====
  nextCreateStatus = "sent"; makeDupOnCreate = false;
  const t8 = Date.now();
  raw.exec(`UPDATE users SET saldo_kredit=7 WHERE id='u1'`);
  raw.exec(`INSERT INTO brands (id,user_id,name,created_at) VALUES ('brY','u1','Brand Y',${S(t8)}),('brX','u1','Brand X',${S(t8)})`);
  raw.exec(`INSERT INTO social_accounts (id,brand_id,platform,publish_via,username,connected,created_at,buffer_channel_id,access_token) VALUES
    ('accY','brY','youtube','buffer','y_yt',1,${S(t8)},'chY','tok-Y'), ('accX','brX','youtube','buffer','x_yt',1,${S(t8)},'chX','tok-X')`);
  const seedScheduled = (id: string, brand: string) => {
    raw.prepare("INSERT INTO projects (id,brand_id,type,status,generated_caption,scheduled_for,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, brand, "video", "scheduled", `Judul ${id}\nisi`, S(t8 - 60_000), S(t8), S(t8));
    raw.prepare("INSERT INTO media_assets (id,project_id,type,file_url,created_at) VALUES (?,?,?,?,?)").run(`ma${id}`, id, "final_video", `https://v/${id}.mp4`, S(t8));
  };
  for (const id of ["y1", "y2", "y3", "y4"]) seedScheduled(id, "brY");
  seedScheduled("x1", "brX");
  raw.transaction(() => { for (let i = 0; i < 2000; i++) ins.run(`x${i}`, ledger.tokenFingerprint("tok-X"), "brX", "chX", "createPost", S(t8)); })();
  const creditTxBefore = q<{ c: number }>("SELECT COUNT(*) c FROM credit_transactions")[0].c;
  const createBefore = hits.createPost ?? 0;
  const res8 = await autoPublish(new NextRequest("http://x/api/cron/auto-publish", { method: "POST", headers: { "x-cron-key": "test-secret" } }));
  const body8 = await res8.json() as { counts: { published: number; skipped_quota: number; skipped_gate: number } };
  const st = (id: string) => q<{ status: string; error_message: string | null }>("SELECT status, error_message FROM projects WHERE id=?", id)[0];
  assert.strictEqual(res8.status, 200);
  assert.strictEqual(body8.counts.published, 1, "anti-burst: 4 scheduled brand Y -> HANYA 1 per siklus");
  assert.strictEqual(["y1", "y2", "y3", "y4"].filter((id) => st(id).status === "published").length, 1, "token sehat (Y) tetap publish");
  assert.strictEqual(body8.counts.skipped_quota, 3, "3 sisanya menunggu siklus berikut (tak burst)");
  assert.strictEqual(st("x1").status, "scheduled", "token X habis -> publish DITAHAN sebelum melewati limit");
  assert.match(st("x1").error_message || "", /budget teknis Buffer token ini habis/);
  assert.doesNotMatch(st("x1").error_message || "", /kuota paket tercapai|kuota paket habis/);
  assert.strictEqual((hits.createPost ?? 0) - createBefore, 1, "tepat 1 createPost; 0 call utk token habis");
  assert.strictEqual(q<{ saldo_kredit: number }>("SELECT saldo_kredit FROM users WHERE id='u1'")[0].saldo_kredit, 7, "kredit TIDAK dipotong saat publish");
  assert.strictEqual(q<{ c: number }>("SELECT COUNT(*) c FROM credit_transactions")[0].c, creditTxBefore, "tak ada transaksi kredit dari publish");
  ok("cron nyata: 1/brand/siklus (anti-burst), token sehat jalan, token habis ditahan dgn alasan teknis, kredit tak dipotong");

  raw.close(); server.close();
  for (const f of [TMP, TMP + "-wal", TMP + "-shm", BAK, BAK + "2"]) rmSync(f, { force: true });
  console.log(`ALL_PUBLISH_E2E_TESTS_PASS (${n} tes)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
