// Verification gate Phase 2 - PRD Agustap Studio §16 "Source Failure": jangan
// mengarang isi kalau reference tidak bisa diakses, fallback manual (transcript/
// screenshot/summary) harus tersedia, dan kegagalan HARUS terjadi SEBELUM panggilan
// OpenAI (zero API cost utk kasus gagal) - tidak butuh network/API key nyata.
//
// Jalankan dengan: npx --yes tsx scripts/verify-agustap-inspiration-analyzer.ts

import {
  analyzeInspiration,
  fetchReferenceText,
  resolveSourceContent,
} from "../src/lib/agustap/inspirationAnalyzer";

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

async function main() {
  console.log("Running Agustap Inspiration Analyzer verification gate\n");

  // --- fetchReferenceText: validasi URL, tanpa network ---
  const badUrl = await fetchReferenceText("bukan-url-valid");
  check("fetchReferenceText: URL tidak valid -> ok:false tanpa network", !badUrl.ok);

  const nonHttp = await fetchReferenceText("ftp://example.com/file");
  check("fetchReferenceText: protokol non-http/https ditolak", !nonHttp.ok);

  // --- resolveSourceContent: prioritas fallback §16 ---
  check(
    "resolveSourceContent: fetch sukses -> pakai url (prioritas tertinggi)",
    resolveSourceContent(
      { transcript: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz" },
      { ok: true, text: "konten dari url" }
    )?.sourceUsed === "url"
  );
  check(
    "resolveSourceContent: fetch gagal + transcript ada (>=50 char) -> pakai transcript",
    resolveSourceContent(
      { transcript: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz" },
      { ok: false, reason: "404" }
    )?.sourceUsed === "transcript"
  );
  check(
    "resolveSourceContent: transcript terlalu pendek (<50 char) -> DILEWATI, coba summary",
    resolveSourceContent(
      { transcript: "terlalu pendek", summary: "ini summary yang cukup panjang utk dipakai" },
      null
    )?.sourceUsed === "summary"
  );
  check(
    "resolveSourceContent: summary terlalu pendek -> coba screenshotDescription",
    resolveSourceContent(
      { summary: "pendek", screenshotDescription: "deskripsi screenshot yang cukup panjang" },
      null
    )?.sourceUsed === "screenshot"
  );
  check(
    "resolveSourceContent: tidak ada satu pun sumber layak -> null",
    resolveSourceContent({}, null) === null
  );

  // --- analyzeInspiration: SOURCE_UNAVAILABLE tanpa panggil OpenAI sama sekali ---
  const emptyResult = await analyzeInspiration({});
  check(
    "analyzeInspiration: input kosong total -> SOURCE_UNAVAILABLE (zero API cost, tidak crash)",
    !emptyResult.ok && emptyResult.error === "SOURCE_UNAVAILABLE"
  );

  const badUrlResult = await analyzeInspiration({ referenceUrl: "bukan-url-valid" });
  check(
    "analyzeInspiration: URL invalid + tanpa fallback -> SOURCE_UNAVAILABLE dgn detail jelas",
    !badUrlResult.ok && badUrlResult.error === "SOURCE_UNAVAILABLE" && badUrlResult.detail.length > 0
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
