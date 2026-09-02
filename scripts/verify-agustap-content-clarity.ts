import { checkContentClarity, type ServiceCatalog } from "../src/lib/agustap/contentClarity";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const REAL_CATALOG: ServiceCatalog = {
  serviceDescription:
    "Agustap Studio menangani riset, strategi, produksi, publishing, dan evaluasi konten " +
    "untuk membantu bisnis membangun awareness, audience, dan peluang penjualan secara organik.",
  packages: [
    { name: "BASIC", price: "Rp1.500.000", features: ["2 video/hari", "1 poster/hari", "90 konten/bulan"] },
    { name: "GROWTH", price: "Rp1.800.000", features: ["4 video/hari", "2 poster/hari", "180 konten/bulan"] },
    { name: "PRO", price: "Rp2.500.000", features: ["6 video/hari", "3 poster/hari", "270 konten/bulan"] },
  ],
  commonFeatures: ["Business Research", "Content Strategy", "Content Production", "SEO Social Media", "TikTok", "Instagram", "Publishing"],
  addOns: ["Facebook +Rp250.000/bulan"],
};

async function main() {
  console.log("Running Agustap Content Clarity verification gate\n");

  // Negative test case RESMI PRD §26 - screenshot asli Agus, HARUS FAIL.
  const negative = await checkContentClarity(
    { caption: "PAKET GROWTH DISKON 2× KONTEN, HARGA SPESIAL\nRp1.800.000\n2× Konten Basic\nAnalytics Advanced\nOptimasi Agresif", promotionalIntensity: 100 },
    REAL_CATALOG
  );
  check("Negative test case PRD §26 (paket tanpa penjelasan layanan) -> FAIL", negative.passed === false, JSON.stringify(negative));

  // Positive example PRD §9 - HARUS PASS.
  const positive = await checkContentClarity(
    {
      caption:
        "Tidak sempat mengurus media sosial bisnis? Agustap Studio membantu bisnis lokal mengelola media sosial dan " +
        "membuat konten secara konsisten. Paket Growth mencakup strategi konten, produksi video & poster, caption, " +
        "jadwal posting, dan evaluasi performa - Rp1.800.000/bulan. Cocok untuk bisnis yang ingin media sosialnya " +
        "dikelola lebih konsisten. Chat admin untuk konsultasi.",
      promotionalIntensity: 100,
    },
    REAL_CATALOG
  );
  check("Positive example PRD §9 (jelas apa yang dijual) -> PASS", positive.passed === true, JSON.stringify(positive));

  // Educational TIDAK butuh service catalog sama sekali (PRD §13).
  const educational = await checkContentClarity(
    {
      caption:
        "Posting setiap hari belum tentu bikin bisnis ramai. Kalau setiap konten hanya bicara soal produk, orang tidak " +
        "punya alasan berhenti scroll. Coba mulai dari masalah pelanggan dulu, baru hubungkan ke produkmu.",
      promotionalIntensity: 20,
    },
    null
  );
  check("Educational tanpa service catalog -> PASS (§13, tidak wajib jualan)", educational.passed === true, JSON.stringify(educational));

  // Promotional TAPI brand belum punya service catalog sama sekali -> FAIL cepat, zero API cost (§20).
  const noCatalog = await checkContentClarity(
    { caption: "Paket Growth Rp1.800.000 - chat admin sekarang!", promotionalIntensity: 100 },
    null
  );
  check(
    "Promotional + service catalog kosong -> FAIL tanpa panggil LLM (§20, zero cost)",
    noCatalog.passed === false && noCatalog.failureReason !== null
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
