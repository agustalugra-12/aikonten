// Agustap Studio Content Intelligence & Faceless Extension - Phase 1 Foundation
// (PRD §7-8, §47). Guard tunggal dipakai SEMUA modul Agustap-specific berikutnya
// (Inspiration Analyzer, extend competitorAnalysis.ts/trendAdaptation.ts, dst) -
// SATU titik source of truth supaya §42/§45 (brand isolation + feature flag safety)
// selalu konsisten, bukan dicek ulang manual di tiap pemanggil.
//
// brand.knowledgeSite dipakai sbg slug canonical (REUSE kolom existing yang sudah
// dipakai pola sama utk brand "pelangi" - lihat generateContent.ts
// `knowledgeSite === "pelangi"` - lihat docs/REUSE_MAP.md; TIDAK bikin kolom slug
// baru). Brand Agustap Studio (`brand_P2BjJgQoG8hL` di server render) di-set
// knowledge_site="agustap_studio" via scripts/agustap-phase1-content-dna.py.
export const AGUSTAP_STUDIO_KNOWLEDGE_SITE = "agustap_studio";

/** PRD §8: default OFF, ON hanya kalau eksplisit di-set "true"/"1" di env. */
export function isAgustapContentIntelligenceEnabled(): boolean {
  const raw = (process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED || "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/**
 * PRD §7: guard brand isolation. True HANYA kalau (a) brand ini Agustap Studio
 * (via knowledgeSite, bukan match nama string bebas - nama brand bisa berubah tanpa
 * sengaja lewat UI edit brand, knowledgeSite tidak) DAN (b) feature flag ON.
 *
 * Dipakai SEBELUM memanggil kemampuan Agustap-specific apa pun (Inspiration
 * Analyzer, Creator Benchmark extend, dst) - kalau false, jalankan behavior
 * ContentPilot existing apa adanya (PRD §45: brand lain / flag OFF = 0 perubahan
 * perilaku).
 */
export function isAgustapExtensionActive(brandKnowledgeSite: string | null | undefined): boolean {
  if (!isAgustapContentIntelligenceEnabled()) return false;
  return brandKnowledgeSite === AGUSTAP_STUDIO_KNOWLEDGE_SITE;
}
