// Alat uji CEPAT VideoPlan: jalankan generateVideoPlan langsung atas brief NYATA lintas brand,
// validasi seketika. Tak perlu menunggu shadow semalaman.
// READ-ONLY terhadap DB (hanya SELECT). Tidak merender, tidak menyentuh produksi.
// Pakai: npx tsx _vplan_bench.ts <label>   -> tulis /home/admin/vplan-bench-<label>.json
process.env.DATABASE_PATH = "/home/admin/kontenpilot-saas/data/kontenpilot.db";
import { readFileSync, writeFileSync } from "node:fs";

const LABEL = process.argv[2] || "run";
const N_PER_BRAND = 3;

type Row = { id: string; brand: string; script: string; angle: string | null; pillar: string | null; hook: string | null; ori: string | null };

async function main() {
  for (const line of readFileSync("/home/admin/kontenpilot-saas/.env", "utf8").split("\n")) {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
  const { sqlite } = await import("./src/db");
  const { generateVideoPlan } = await import("./src/lib/video/videoPlanDirector");

  // brief NYATA: ambil N proyek terbaru per brand yang punya naskah + footage
  const rows = sqlite.prepare(`
    SELECT p.id, b.name AS brand, p.script, p.angle, p.pillar, p.cta_text AS hook, p.content_format AS ori
    FROM projects p JOIN brands b ON b.id = p.brand_id
    WHERE p.script IS NOT NULL AND length(p.script) > 200
      AND EXISTS (SELECT 1 FROM media_assets m WHERE m.project_id = p.id AND m.type IN ('raw_footage','broll_used'))
    ORDER BY p.created_at DESC`).all() as Row[];

  // Perbandingan ADIL: kalau sudah ada hasil "sebelum", pakai id yang PERSIS SAMA.
  const fsb = require("node:fs");
  let dipilihTetap: string[] | null = null;
  try {
    if (LABEL !== "sebelum" && fsb.existsSync("/home/admin/vplan-bench-sebelum.json")) {
      const prev = JSON.parse(fsb.readFileSync("/home/admin/vplan-bench-sebelum.json", "utf8"));
      dipilihTetap = (prev.hasil as Array<{ id: string }>).map((h) => h.id);
      console.log("memakai " + dipilihTetap.length + " id yang SAMA dgn benchmark sebelum");
    }
  } catch { dipilihTetap = null; }
  const perBrand: Record<string, number> = {};
  const dipilih: Row[] = [];
  if (dipilihTetap) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of dipilihTetap) { const r = byId.get(id); if (r) dipilih.push(r); }
  } else {
    for (const r of rows) {
      perBrand[r.brand] = perBrand[r.brand] || 0;
      if (perBrand[r.brand] >= N_PER_BRAND) continue;
      perBrand[r.brand]++; dipilih.push(r);
    }
  }
  console.log(`brief nyata dipilih: ${dipilih.length} dari ${rows.length} kandidat`);

  const hasil: Array<{ id: string; brand: string; ok: boolean; errors: string[]; audio: number; longform: boolean; cost: number; ms: number }> = [];
  for (const r of dipilih) {
    const fo = sqlite.prepare(
      "SELECT id, COALESCE(source_query, source, 'klip') AS label, COALESCE(duration_seconds,5) AS d FROM media_assets WHERE project_id=? AND type IN ('raw_footage','broll_used') LIMIT 12"
    ).all(r.id) as Array<{ id: string; label: string; d: number }>;
    // durasi VO diperkirakan dari jumlah kata (TTS Indonesia ~2,5 kata/detik) - deterministik
    const kata = r.script.trim().split(/\s+/).length;
    const audio = Math.round((kata / 2.5) * 10) / 10;
    const inp = {
      projectId: r.id, brandName: r.brand,
      brief: [r.angle, r.pillar].filter(Boolean).join(" · ") || "konten sosial media",
      script: r.script, hookText: r.hook, orientation: "portrait" as const, brandLook: null,
      footage: fo.map((f) => ({ id: f.id, label: String(f.label), durationSeconds: Number(f.d), source: "brand" as const })),
      audioDurationSeconds: audio, internal: true,
    };
    const res = await generateVideoPlan(inp);
    const longform = audio > 112; // > totalSeconds.max(90) * 1.25 -> total_vs_audio MUSTAHIL
    hasil.push({ id: r.id, brand: r.brand, ok: res.ok, errors: res.errors, audio, longform, cost: res.costUsd, ms: res.latencyMs });
    console.log(`${res.ok ? "LOLOS " : "gagal "} ${r.brand.padEnd(20)} audio=${String(audio).padStart(6)}s ${longform ? "[LONGFORM]" : "          "} ${res.errors.slice(0, 3).join(" | ")}`);
  }

  const pendek = hasil.filter((h) => !h.longform);
  const panjang = hasil.filter((h) => h.longform);
  const lolos = hasil.filter((h) => h.ok).length;
  const lolosPendek = pendek.filter((h) => h.ok).length;

  const jenis: Record<string, number> = {};
  for (const h of hasil) for (const e of h.errors) {
    const k = String(e).replace(/\$\.scenes\[\d+\]\.?/g, "").replace(/\[\d+\]/g, "[]").replace(/\((?:[^()]*)\)/g, "");
    jenis[k] = (jenis[k] || 0) + 1;
  }
  console.log(`\n=== ${LABEL} ===`);
  console.log(`TOTAL     : ${lolos}/${hasil.length} lolos (${((lolos / hasil.length) * 100).toFixed(0)}%)`);
  console.log(`short-form: ${lolosPendek}/${pendek.length} lolos (${pendek.length ? ((lolosPendek / pendek.length) * 100).toFixed(0) : 0}%)`);
  console.log(`long-form : ${panjang.filter((h) => h.ok).length}/${panjang.length} lolos  (audio > 112s)`);
  console.log(`biaya AI  : US$${hasil.reduce((a, h) => a + h.cost, 0).toFixed(4)}  latency rata2 ${Math.round(hasil.reduce((a, h) => a + h.ms, 0) / hasil.length)}ms`);
  console.log("pelanggaran (urut terbanyak):");
  for (const [k, n] of Object.entries(jenis).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}x  ${k}`);
  writeFileSync(`/home/admin/vplan-bench-${LABEL}.json`, JSON.stringify({ label: LABEL, hasil, jenis }, null, 2));
  console.log("BENCH_DONE");
}
main().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
