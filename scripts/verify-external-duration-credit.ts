// Tes INTEGRASI aturan durasi/scenes tenant EKSTERNAL vs kredit (2026-11-05). DB sqlite TEMP (skema prod,
// tanpa data) + route NYATA process/retry + runAutoContent NYATA - TANPA jaringan, TANPA OpenAI/ffmpeg/TTS,
// TANPA belanja kredit/API asli. processProject SENGAJA gagal OFFLINE (script=null -> lempar sebelum API apa pun)
// supaya jalur refund route diuji utuh. Fokus: (1) kredit dipotong di AWAL job valid; (2) gagal durasi -> refund
// TEPAT 1x; (3) retry project gagal yg sama tak dobel-refund/dobel-charge; (4) fallback ffmpeg jepit 30-60;
// (5) project LAMA di luar 30-60 & engine scenes ditolak SEBELUM kredit (route + jalur otomatis). Jalankan:
//   npx tsx scripts/verify-external-duration-credit.ts
import assert from "node:assert";
import Database from "better-sqlite3";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = join(tmpdir(), `kp-extdur-${process.pid}.db`);
for (const f of [TMP, TMP + "-wal", TMP + "-shm"]) rmSync(f, { force: true });
const setup = new Database(TMP);
setup.exec(readFileSync(join(__dirname, "fixtures/prod-schema-2026-11-04.sql"), "utf8"));
setup.close();
const S = (ms: number) => Math.floor(ms / 1000);

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
  Object.assign(process.env, {
    DATABASE_PATH: TMP,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-test", // defensif: tak pernah dipanggil (gagal offline duluan)
  });
  delete process.env.TELEGRAM_BOT_TOKEN; // alert gagal = no-op, tanpa jaringan

  // Import SETELAH env di-set (db singleton baca DATABASE_PATH saat import).
  const { NextRequest } = await import("next/server");
  const { POST: processPost } = await import("@/app/api/projects/[id]/process/route");
  const { POST: retryPost } = await import("@/app/api/projects/[id]/retry/route");
  const { runAutoContent, AutoContentError } = await import("@/lib/pipeline/autoContent");
  const { batasRenderDetik, cekDurasiHasil } = await import("@/lib/billing/durasiVideo");
  const { sesuaikanDurasiVoiceover } = await import("@/lib/ai/dubbing");
  const { pastikanFormatDiizinkan } = await import("@/lib/billing/aturanProduk");

  const raw = new Database(TMP);
  const q = <T,>(sql: string, ...p: unknown[]) => raw.prepare(sql).all(...p) as T[];
  const saldo = (uid: string) => q<{ saldo_kredit: number }>("SELECT saldo_kredit FROM users WHERE id=?", uid)[0].saldo_kredit;
  const txFor = (uid: string) => q<{ jumlah: number; alasan: string; saldo_setelah: number; ref_project_id: string | null }>(
    "SELECT jumlah, alasan, saldo_setelah, ref_project_id FROM credit_transactions WHERE user_id=? ORDER BY created_at, rowid", uid);
  const refundCount = (uid: string) => txFor(uid).filter((r) => r.alasan === "refund_gagal").length;
  const deductCount = (uid: string) => txFor(uid).filter((r) => r.jumlah < 0).length;

  const t = Date.now();
  // --- data: 1 user eksternal (unlimited=0, saldo 10), 1 internal (unlimited=1) ---
  raw.exec(`INSERT INTO users (id,email,password_hash,created_at,unlimited,saldo_kredit,status) VALUES
    ('uExt','e@x','h',${S(t)},0,10,'aktif'), ('uInt','i@x','h',${S(t)},1,5,'aktif')`);
  const brand = (id: string, uid: string, target: number, kit: string | null) =>
    raw.prepare("INSERT INTO brands (id,user_id,name,video_duration_target,brand_kit,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, uid, `B ${id}`, target, kit, S(t));
  const project = (id: string, brandId: string, script: string | null) =>
    raw.prepare("INSERT INTO projects (id,brand_id,type,script,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, brandId, "video", script, "uploaded", S(t), S(t));
  brand("bExt", "uExt", 60, null);                                  // eksternal valid in-range
  brand("bExt90", "uExt", 90, null);                                // eksternal LAMA: target >60 (dulu tersimpan)
  brand("bExtSc", "uExt", 60, JSON.stringify({ renderEngine: "scenes" })); // eksternal engine scenes
  brand("bInt", "uInt", 480, JSON.stringify({ renderEngine: "scenes" }));  // internal boleh scenes + long-form
  project("P1", "bExt", null);   // valid in-range, TAPI script null -> processProject gagal OFFLINE
  project("Pold", "bExt90", "x"); // out-of-range target (project lama)
  project("Psc", "bExtSc", "x");  // engine scenes

  const callProcess = async (uid: string, pid: string) => {
    const req = new NextRequest(`http://x/api/projects/${pid}/process`, { method: "POST", headers: { "x-user-id": uid } });
    const res = await processPost(req, { params: Promise.resolve({ id: pid }) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean } };
  };
  const callRetry = async (uid: string, pid: string) => {
    const req = new NextRequest(`http://x/api/projects/${pid}/retry`, { method: "POST", headers: { "x-user-id": uid } });
    const res = await retryPost(req, { params: Promise.resolve({ id: pid }) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean } };
  };

  // ===== (1)+(2) job valid: potong di AWAL, processProject gagal -> refund TEPAT 1x (route NYATA) =====
  assert.strictEqual(saldo("uExt"), 10); assert.strictEqual(txFor("uExt").length, 0);
  const r1 = await callProcess("uExt", "P1");
  assert.strictEqual(r1.status, 500, `P1 harus 500 (processProject gagal): ${JSON.stringify(r1.body)}`);
  assert.ok(/script/i.test(r1.body.error || ""), `pesan gagal processProject: ${r1.body.error}`);
  const txP1 = txFor("uExt");
  const deductP1 = txP1.filter((r) => r.jumlah === -1 && r.alasan === "generate_video" && r.ref_project_id === "P1");
  const refundP1 = txP1.filter((r) => r.jumlah === 1 && r.alasan === "refund_gagal");
  assert.strictEqual(deductP1.length, 1, "kredit dipotong TEPAT 1x di awal (generate_video, ref P1)");
  assert.strictEqual(deductP1[0].saldo_setelah, 9, "potong di AWAL job: saldo turun ke 9 sebelum processProject");
  assert.strictEqual(refundP1.length, 1, "gagal durasi/processProject -> refund TEPAT 1x (bukan 0, bukan 2)");
  assert.strictEqual(txP1.length, 2, "tepat 2 baris ledger (1 potong + 1 refund)");
  assert.strictEqual(saldo("uExt"), 10, "net nol setelah refund");
  ok("(1)(2) job valid: kredit dipotong di AWAL (saldo 10->9) lalu gagal -> refund TEPAT 1x (net 10); 2 baris ledger");

  // ===== (3) RETRY project gagal yg sama (tanpa final asset -> mode process): tak dobel-refund/charge =====
  const r3 = await callRetry("uExt", "P1");
  assert.strictEqual(r3.status, 500, `retry P1 harus 500 (gagal lagi): ${JSON.stringify(r3.body)}`);
  assert.strictEqual(deductCount("uExt"), 2, "2 percobaan = 2 potong (retry tak dobel-charge dalam 1 percobaan)");
  assert.strictEqual(refundCount("uExt"), 2, "2 percobaan gagal = 2 refund (retry tak dobel-refund percobaan pertama)");
  assert.strictEqual(txFor("uExt").length, 4, "tepat 4 baris (2 potong + 2 refund), tiap percobaan berpasangan");
  assert.strictEqual(saldo("uExt"), 10, "retry tetap net nol");
  // Jalur publish-only (ada final asset) TAK memotong/refund kredit sama sekali (struktur route).
  const retrySrc = readFileSync(join(__dirname, "..", "src/app/api/projects/[id]/retry/route.ts"), "utf8");
  assert.ok(retrySrc.indexOf('mode: "publish"') < retrySrc.indexOf("await potongKredit("), "retry publish-only return SEBELUM potong kredit (tak dobel-charge)");
  ok("(3) retry project gagal yg sama: tiap percobaan 1 potong + 1 refund (total 2+2), net nol; publish-only tak menagih");

  // ===== (4) fallback ffmpeg: batas keras -t & gerbang pasca-render dijepit 30-60 (+mekanisme gagal durasi) =====
  assert.strictEqual(batasRenderDetik(false, undefined), 60);
  assert.strictEqual(batasRenderDetik(false, 45), 45);
  assert.strictEqual(batasRenderDetik(true, undefined), undefined);
  assert.strictEqual(batasRenderDetik(true, 60), 60);
  assert.ok(cekDurasiHasil(29, false) && cekDurasiHasil(61, false), "hasil <30 / >60 ditolak utk eksternal");
  assert.strictEqual(cekDurasiHasil(45, false), null, "hasil 45 dtk lolos");
  assert.strictEqual(cekDurasiHasil(45, true), null, "internal tak digerbangi");
  // Mekanisme gagal-durasi yg memicu refund route di atas: narasi 70 dtk tak bisa dikoreksi -> lempar.
  await assert.rejects(sesuaikanDurasiVoiceover(Buffer.from("vo"), false, { durasi: async () => 70 }), /terlalu panjang/);
  assert.deepStrictEqual(await sesuaikanDurasiVoiceover(Buffer.from("vo"), true, { durasi: async () => { throw new Error("tak diukur"); } }), { buffer: Buffer.from("vo"), catatan: null });
  ok("(4) fallback ffmpeg dijepit -t 60 & hasil di luar 30-60 ditolak; narasi 70s -> error (sumber refund); internal bebas");

  // ===== (5a) project LAMA di luar 30-60 & engine scenes: ROUTE tolak 403 SEBELUM kredit (tak ditagih) =====
  const txBefore5 = txFor("uExt").length;
  const rOld = await callProcess("uExt", "Pold");
  assert.strictEqual(rOld.status, 403, `project lama target 90 harus 403: ${JSON.stringify(rOld.body)}`);
  assert.ok(/tidak tersedia|60 detik|video panjang/i.test(rOld.body.error || ""), `pesan jelas project lama: ${rOld.body.error}`);
  const rSc = await callProcess("uExt", "Psc");
  assert.strictEqual(rSc.status, 403, `engine scenes harus 403: ${JSON.stringify(rSc.body)}`);
  assert.ok(/Desain|scenes/i.test(rSc.body.error || ""), `pesan jelas scenes: ${rSc.body.error}`);
  assert.strictEqual(q<{ c: number }>("SELECT COUNT(*) c FROM credit_transactions WHERE ref_project_id IN ('Pold','Psc')")[0].c, 0, "project lama/scenes: 0 baris kredit (ditolak sebelum potong)");
  assert.strictEqual(txFor("uExt").length, txBefore5, "penolakan route tak menambah baris ledger apa pun");
  assert.strictEqual(saldo("uExt"), 10, "saldo tak berubah oleh penolakan");
  ok("(5a) ROUTE: project lama >60 dtk & engine scenes ditolak 403 jelas SEBELUM potong kredit (0 baris ledger)");

  // ===== (5b) jalur OTOMATIS (runAutoContent: cron auto-generate & planner): tolak SEBELUM kredit =====
  const isAturan = (e: unknown) => e instanceof AutoContentError && (e as unknown as { kodeAturan?: string }).kodeAturan === "video_panjang";
  await assert.rejects(runAutoContent("bExt90", "x", "video"), isAturan); // out-of-range (project lama via planner/cron)
  await assert.rejects(runAutoContent("bExtSc", "x", "video"), isAturan); // engine scenes
  assert.strictEqual(saldo("uExt"), 10, "jalur otomatis tolak: saldo tak berubah");
  assert.strictEqual(txFor("uExt").length, txBefore5, "jalur otomatis tolak: 0 baris ledger baru");
  // Internal/unlimited TETAP boleh scenes & long-form (gerbang tak melempar).
  assert.doesNotThrow(() => pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 480, unlimited: true, renderEngine: "scenes" }));
  assert.strictEqual(saldo("uInt"), 5, "user internal tak tersentuh");
  ok("(5b) OTOMATIS runAutoContent tolak out-of-range & scenes SEBELUM kredit (kodeAturan video_panjang); internal tetap boleh scenes/long-form");

  raw.close();
  for (const f of [TMP, TMP + "-wal", TMP + "-shm"]) rmSync(f, { force: true });
  console.log(`ALL_EXTERNAL_DURATION_CREDIT_TESTS_PASS (${n} tes)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
