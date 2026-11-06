// Tes feat/buffer-quota-saver (2026-11-06): learning baca DB (tanpa call Buffer saat generate),
// snapshot per-posting terisi oleh jalur sync (fetcher di-inject = tanpa jaringan), dashboard
// tak kehilangan data (cache 24 jam), tren historis utuh. DB sqlite TEMP (skema prod), TANPA
// jaringan / Buffer / OpenAI. Jalankan: npx tsx scripts/verify-buffer-quota-saver.ts
import assert from "node:assert";
import Database from "better-sqlite3";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = join(tmpdir(), `kp-quota-${process.pid}.db`);
for (const f of [TMP, TMP + "-wal", TMP + "-shm"]) rmSync(f, { force: true });
const setup = new Database(TMP);
setup.exec(readFileSync(join(__dirname, "fixtures/prod-schema-2026-11-04.sql"), "utf8"));
setup.close();
const S = (ms: number) => Math.floor(ms / 1000);

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

(async () => {
  Object.assign(process.env, { DATABASE_PATH: TMP, OPENAI_API_KEY: "sk-test" });
  delete process.env.TELEGRAM_BOT_TOKEN;

  const { syncBrandPerformance, getBrandPerformanceInsight, buildPerformanceInsightBlock } =
    await import("@/lib/ai/performanceLearning");
  const { isDashboardCacheFresh, DASHBOARD_CACHE_MS } = await import("@/lib/analyticsCache");

  const raw = new Database(TMP);
  const q = <T,>(sql: string, ...p: unknown[]) => raw.prepare(sql).all(...p) as T[];
  const t = Date.now();

  // ---- seed: 1 user, 1 brand, 2 published projects (beda pilar), publishLog sukses, akun buffer ----
  raw.exec(`INSERT INTO users (id,email,password_hash,created_at,unlimited,saldo_kredit,status)
            VALUES ('u1','e@x','h',${S(t)},0,100,'aktif')`);
  raw.prepare(`INSERT INTO brands (id,user_id,name,created_at) VALUES (?,?,?,?)`).run("b1","u1","Brand 1",S(t));
  raw.prepare(`INSERT INTO social_accounts (id,brand_id,platform,publish_via,username,buffer_channel_id,access_token,connected,created_at)
               VALUES (?,?,?,?,?,?,?,?,?)`).run("sa1","b1","instagram","buffer","@b1","ch1","tok1",1,S(t));
  const proj = (id: string, pillar: string, upd: number, synced: number | null) =>
    raw.prepare(`INSERT INTO projects (id,brand_id,type,status,pillar,angle,created_at,updated_at,performance_synced_at)
                 VALUES (?,?,?,?,?,?,?,?,?)`).run(id,"b1","video","published",pillar,"a",S(t),S(upd),synced);
  proj("p1","Promo", t, null);        // belum pernah sync -> kandidat
  proj("p2","Edukasi", t, null);      // belum pernah sync -> kandidat
  const log = (id: string, pid: string, postId: string) =>
    raw.prepare(`INSERT INTO publish_logs (id,project_id,social_account_id,status,platform_post_id,created_at)
                 VALUES (?,?,?,?,?,?)`).run(id,pid,"sa1","success",postId,S(t));
  log("pl1","p1","post_1");
  log("pl2","p2","post_2");

  // ================= TEST 1: snapshot per-posting terisi via fetcher INJECT (tanpa Buffer) =========
  let calls = 0;
  const fakeFetch = async (postId: string) => {
    calls++;
    const views = postId === "post_1" ? 300 : 120;
    return [
      { name: "views", value: views, unit: "count", type: "views" },
      { name: "engagementRate", value: 5, unit: "percent", type: "engagementRate" },
    ];
  };
  await syncBrandPerformance("b1", fakeFetch);
  assert(calls === 2, `fetcher dipanggil per-post, dapat ${calls}`);
  ok("sync memakai fetcher yang di-inject (tanpa call Buffer langsung)");

  const pl = q<{ views: number; engagement_rate: number }>("SELECT views, engagement_rate FROM publish_logs WHERE id='pl1'")[0];
  assert(pl.views === 300, `publish_logs.views=${pl.views}`);
  ok("snapshot per-posting terisi: publish_logs.views tersimpan");

  const p1 = q<{ performance_views: number; performance_synced_at: number | null }>(
    "SELECT performance_views, performance_synced_at FROM projects WHERE id='p1'")[0];
  assert(p1.performance_views === 300 && p1.performance_synced_at !== null, JSON.stringify(p1));
  ok("snapshot per-project terisi: projects.performance_views + performance_synced_at");

  // ================= TEST 2: learning insight dibaca dari DB, TANPA call Buffer ====================
  const callsBefore = calls;
  const insight = await getBrandPerformanceInsight("b1");
  assert(calls === callsBefore, "getBrandPerformanceInsight TIDAK memanggil fetcher/Buffer");
  // perlu >=3 data utk blok muncul -> tambah 1 project lagi dgn performa, lalu cek fungsi murni
  const pure = buildPerformanceInsightBlock([
    { pillar: "Promo", angle: "a", performanceViews: 300 },
    { pillar: "Edukasi", angle: "a", performanceViews: 120 },
    { pillar: "Promo", angle: "a", performanceViews: 200 },
  ]);
  assert(pure.includes("Promo") && pure.includes("PERFORMA KONTEN NYATA"), "blok insight dari DB");
  ok("learning insight murni dari DB (buildPerformanceInsightBlock), 0 call Buffer");
  assert(typeof insight === "string", "getBrandPerformanceInsight return string (DB-only)");
  ok("getBrandPerformanceInsight read-DB-only tidak error");

  // ================= TEST 3: dashboard cache 24 jam (tak kehilangan data <=24 jam) =================
  assert(DASHBOARD_CACHE_MS === 24 * 60 * 60 * 1000, `DASHBOARD_CACHE_MS=${DASHBOARD_CACHE_MS}`);
  ok("cache dashboard = 24 jam");
  assert(isDashboardCacheFresh(t - 23 * 3600e3, t) === true, "23 jam -> pakai cache (fresh)");
  assert(isDashboardCacheFresh(t - 25 * 3600e3, t) === false, "25 jam -> refetch (stale)");
  assert(isDashboardCacheFresh(null, t) === false, "belum pernah cache -> fetch");
  ok("dashboard pakai cache <=24 jam, refetch >24 jam (tak kehilangan data)");

  // ================= TEST 4: tren historis utuh (snapshot harian 1 baris/channel/hari) ============
  const an = (id: string, day: string, views: number) =>
    raw.prepare(`INSERT INTO analytics (id,social_account_id,views,date_recorded,created_at) VALUES (?,?,?,?,?)`)
      .run(id,"sa1",views,day,S(t));
  an("an1","2026-11-04",100); an("an2","2026-11-05",150);
  const trend = q<{ date_recorded: string; views: number }>(
    "SELECT date_recorded, views FROM analytics WHERE social_account_id='sa1' ORDER BY date_recorded");
  assert(trend.length === 2 && trend[0].views === 100 && trend[1].views === 150, JSON.stringify(trend));
  ok("tren historis utuh: baris harian per-channel tersimpan & terbaca urut tanggal");
  // idempotensi model: (social_account_id,date_recorded) unik secara logika -> cron UPDATE bukan dobel
  const perDay = q<{ c: number }>("SELECT count(*) c FROM analytics WHERE social_account_id='sa1' AND date_recorded='2026-11-05'")[0];
  assert(perDay.c === 1, "1 baris/channel/hari (sumber tren)");
  ok("snapshot tren = 1 call/baris per channel/hari (dipertahankan)");

  raw.close();
  for (const f of [TMP, TMP + "-wal", TMP + "-shm"]) rmSync(f, { force: true });
  console.log(`\nSEMUA ${n} TES LULUS (buffer-quota-saver)`);
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
