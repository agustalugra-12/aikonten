import { runPrePublishQC } from "../src/lib/ai/prePublishQC";

// Verifikasi konsolidasi QC (2026-09-07, audit "AI Konten Fase 7-10" §10.8 - "QC 10
// dimensi"). Retention Risk & Fact Check SUDAH dihitung di produksi (bukan di sini) -
// yang diuji cuma bagian BACA ULANG-nya: parsing JSON kolom projects.retentionRisks/
// factCheckFlags & mapping ke QCCheck yang benar. TIDAK memanggil AI/hashtag-tracking
// DB beneran (getOverusedHashtags butuh DB) - brandId palsu, hasil hashtag-repetition
// check diabaikan di assertion (fokus ke 2 check baru saja).

let failed = false;

function assertCheck(checks: { name: string; passed: boolean; severity: string }[], name: string, expectedPassed: boolean, expectedSeverity: string, msg: string) {
  const c = checks.find((x) => x.name === name);
  if (!c) {
    console.error(`FAIL: ${msg} - check "${name}" tidak ditemukan di hasil QC`);
    failed = true;
    return;
  }
  if (c.passed !== expectedPassed || c.severity !== expectedSeverity) {
    console.error(`FAIL: ${msg} - got passed=${c.passed} severity=${c.severity}, expected passed=${expectedPassed} severity=${expectedSeverity}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function main() {
  const base = {
    id: "test-project",
    generatedCaption: "Ini caption test yang cukup panjang untuk lolos check pertama, hubungi admin ya!",
    generatedHashtags: JSON.stringify(["#test", "#konten"]),
    similarityScore: 20,
    pillar: "Edukasi",
  };

  {
    const result = await runPrePublishQC("test-brand-tanpa-kb", {
      ...base,
      retentionRisks: JSON.stringify([]),
      factCheckConfidence: null,
      factCheckFlags: null,
    });
    assertCheck(result.checks, "Retention Risk", true, "info", "retentionRisks kosong -> passed, severity info");
    assertCheck(result.checks, "Fact Check", true, "info", "factCheckConfidence null (brand tanpa KB) -> passed, TIDAK dianggap gagal");
  }

  {
    const result = await runPrePublishQC("test-brand-tanpa-kb", {
      ...base,
      retentionRisks: JSON.stringify(["Hook terlalu panjang utk video pendek"]),
      factCheckConfidence: 60,
      factCheckFlags: JSON.stringify(["klaim harga tidak didukung data"]),
    });
    assertCheck(result.checks, "Retention Risk", false, "warning", "retentionRisks ada isi -> gagal tapi severity warning (bukan error)");
    assertCheck(result.checks, "Fact Check", false, "warning", "factCheckFlags ada isi -> gagal tapi severity warning (bukan error, factCheck sengaja warning-only)");
  }

  {
    const result = await runPrePublishQC("test-brand-tanpa-kb", {
      ...base,
      retentionRisks: "{ini bukan json valid",
      factCheckConfidence: 90,
      factCheckFlags: "{ini juga bukan json valid",
    });
    assertCheck(result.checks, "Retention Risk", true, "info", "retentionRisks JSON rusak -> fallback array kosong, tidak crash");
    assertCheck(result.checks, "Fact Check", true, "info", "factCheckFlags JSON rusak -> fallback array kosong, tidak crash");
  }

  // QC lama (severity error) TIDAK BOLEH ikut ter-downgrade jadi "tidak passed keseluruhan"
  // krn 2 check baru ini - pastikan check baru TIDAK PERNAH severity "error" (factCheck/
  // retention sengaja warning-only by design, lihat catatan priceValidator.ts).
  {
    const result = await runPrePublishQC("test-brand-tanpa-kb", {
      ...base,
      retentionRisks: JSON.stringify(["risk A", "risk B"]),
      factCheckConfidence: 40,
      factCheckFlags: JSON.stringify(["klaim A", "klaim B"]),
    });
    const retention = result.checks.find((c) => c.name === "Retention Risk");
    const factCheck = result.checks.find((c) => c.name === "Fact Check");
    if (retention?.severity === "error" || factCheck?.severity === "error") {
      console.error("FAIL: Retention Risk/Fact Check TIDAK BOLEH severity 'error' (harus tetap warning-only by design)");
      failed = true;
    } else {
      console.log("PASS: Retention Risk & Fact Check tetap warning-only walau ada banyak temuan");
    }
  }

  if (failed) {
    console.error("\n=== ADA YANG GAGAL ===");
    process.exit(1);
  } else {
    console.log("\n=== SEMUA PASS ===");
  }
}

main();
