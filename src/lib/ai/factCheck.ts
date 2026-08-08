import { getOpenAIClient } from "./openaiClient";

// Fact Check Engine v1 (2026-08-08, PRD "YouTube Content & Monetization Safety System"
// Section 12) - kelas masalah yang SAMA dgn AI Blog web-pelangi (repo lain, sudah punya
// fact-check gate berbasis Serper), TAPI arsitekturnya BEDA di sini SENGAJA: kontenpilot-
// ai sudah py keputusan Agus eksplisit (lihat researchTopics.ts) - "pakai pengetahuan GPT
// saja, BUKAN integrasi API tren berbayar". Fact-check versi ini konsisten dgn prinsip
// itu: cross-check caption TERHADAP Knowledge Base brand sendiri (yang SUDAH ada di
// context generation, lihat buildKnowledgeGroundingBlock di generateContent.ts) via 1
// panggilan GPT, BUKAN pencarian web berbayar terpisah - lebih murah & konsisten dgn
// filosofi app ini, walau cakupannya HANYA sebatas "konsisten dgn KB brand", bukan
// "benar secara faktual ke dunia nyata" (KB kosong = tidak ada apa pun utk dicek
// terhadap - lihat handling di bawah).
//
// SENGAJA WARNING-ONLY (skor+flag disimpan, generate TIDAK diblokir) - sama filosofi
// dgn contentSimilarity.ts yang baru dibangun (lihat catatan lengkap di sana &
// projects.similarityScore) - PRD minta reject di bawah confidence 80, tapi tanpa data
// nyata utk kalibrasi, memblokir produksi konten harian Agus lebih beresiko drpd
// manfaatnya sekarang.
const FACT_CHECK_MODEL = "gpt-4.1-mini";

export type FactCheckResult = {
  confidence: number; // 0-100
  unsupportedClaims: string[];
};

// null (bukan {confidence:100,...}) kalau brand tidak punya Knowledge Base sama sekali -
// TIDAK ADA APA PUN utk dicek terhadap, beda makna dari "sudah dicek & lolos semua".
// Pemanggil (processProject.ts) WAJIB bedakan null (skip, tidak relevan) dari hasil asli.
export async function factCheckCaption(caption: string, knowledgeBase: string): Promise<FactCheckResult | null> {
  const kb = (knowledgeBase || "").trim();
  if (!kb || !caption.trim()) return null;

  const client = getOpenAIClient();
  const system =
    "Kamu fact-checker teliti. Bandingkan SATU caption/naskah promosi terhadap Knowledge " +
    "Base resmi properti yang diberikan. Tandai klaim FAKTUAL SPESIFIK (harga, fasilitas, " +
    "jarak/lokasi, nama tempat, jam operasional, kapasitas) yang TIDAK didukung atau " +
    "BERTENTANGAN dengan Knowledge Base - JANGAN tandai kalimat generik/opini/ajakan " +
    "(mis. \"suasananya sejuk\", \"cocok untuk healing\", CTA) sebagai klaim faktual, itu " +
    "bukan sesuatu yang perlu diverifikasi. \"confidence\" WAJIB merepresentasikan " +
    "seberapa YAKIN caption ini AMAN dipublikasikan tanpa risiko menyesatkan tamu - kalau " +
    "ADA SATU SAJA klaim yang tidak didukung/bertentangan, confidence WAJIB turun " +
    "signifikan (di bawah 50 kalau kontradiksi jelas spt fasilitas yang eksplisit TIDAK " +
    "ADA di Knowledge Base), BUKAN skor keyakinan kamu atas analisis sendiri.";
  const user =
    `# KNOWLEDGE BASE\n${kb}\n\n# CAPTION YANG DICEK\n${caption}\n\n` +
    'Balas HARUS JSON valid (tanpa markdown code fence): {"confidence": 0-100 (100 = semua ' +
    'klaim faktual didukung penuh KB atau tidak ada klaim faktual sama sekali, turun ' +
    'sebanding jumlah&keparahan klaim tak-didukung/bertentangan), "unsupported_claims": ' +
    '["kutipan klaim dari caption", ...] (array kosong kalau tidak ada masalah)}';

  const completion = await client.chat.completions.create({
    model: FACT_CHECK_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
    const unsupportedClaims = Array.isArray(parsed.unsupported_claims)
      ? parsed.unsupported_claims.filter((c: unknown): c is string => typeof c === "string")
      : [];
    return { confidence, unsupportedClaims };
  } catch {
    return null; // respons tidak valid - dilewati, jangan gagalkan generate cuma krn ini
  }
}
