import { analyzeRetentionRisk } from "../src/lib/ai/retentionIntelligence";

let failed = false;

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${msg} - got ${a}, expected ${e}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const base = {
  hookText: "Pernah bingung",
  totalDurationSeconds: 60,
  hookType: "curiosity",
  structureOverused: false,
  hookTypeOverused: false,
  similarityScore: null as number | null,
};

{
  // Hook pendek (2 kata, ~0.8dtk pada 2.5 kata/dtk), video pendek - tidak ada risiko intro
  assertEqual(analyzeRetentionRisk(base), [], "no risk: hook pendek, semua sinyal aman");
}
{
  // Hook 15 kata (~6dtk) di video pendek (<=60dtk, threshold 5dtk) -> flagged
  const longHook = "Pernah bingung kenapa laundry di Bali selalu penuh setiap akhir pekan datang lagi";
  const risks = analyzeRetentionRisk({ ...base, hookText: longHook });
  assertEqual(risks.some((r) => r.includes("Intro terlalu panjang")), true, "risk: hook panjang di video pendek -> flagged");
}
{
  // Hook sama panjang tapi video PANJANG (>60dtk, threshold 8dtk) -> TIDAK flagged
  const longHook = "Pernah bingung kenapa laundry di Bali selalu penuh setiap akhir pekan datang lagi";
  const risks = analyzeRetentionRisk({ ...base, hookText: longHook, totalDurationSeconds: 180 });
  assertEqual(risks.some((r) => r.includes("Intro terlalu panjang")), false, "no risk: hook sama tapi video panjang, threshold lebih longgar");
}
{
  const risks = analyzeRetentionRisk({ ...base, hookType: null });
  assertEqual(risks.some((r) => r.includes("Hook tidak jelas kategorinya")), true, "risk: hookType null -> flagged");
}
{
  const risks = analyzeRetentionRisk({ ...base, structureOverused: true });
  assertEqual(risks.some((r) => r.includes("monoton")), true, "risk: structureOverused -> flagged monoton");
}
{
  const risks = analyzeRetentionRisk({ ...base, hookTypeOverused: true });
  assertEqual(risks.some((r) => r.includes("monoton")), true, "risk: hookTypeOverused -> flagged monoton");
}
{
  const risks = analyzeRetentionRisk({ ...base, similarityScore: 80 });
  assertEqual(risks.some((r) => r.includes("mirip konten sebelumnya")), true, "risk: similarity tinggi (tier regenerate) -> flagged");
}
{
  const risks = analyzeRetentionRisk({ ...base, similarityScore: 30 });
  assertEqual(risks.some((r) => r.includes("mirip konten sebelumnya")), false, "no risk: similarity rendah (tier safe) -> tidak flagged");
}
{
  // hookText null (mis. field gagal parse) - skip cek durasi hook, tidak crash
  const risks = analyzeRetentionRisk({ ...base, hookText: null });
  assertEqual(risks.some((r) => r.includes("Intro terlalu panjang")), false, "no crash: hookText null -> skip cek durasi hook");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}
