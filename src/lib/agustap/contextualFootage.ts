import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { deriveBrollKeywordsFromScript } from "@/lib/ai/deriveBrollKeywords";

// Contextual Footage & Visual Relevance (PRD "Agustap Studio - Contextual Footage &
// Visual Relevance System", 2026-09-02). Masalah nyata: deriveBrollKeywordsFromScript
// generik (dipakai SEMUA brand) bisa hasilkan keyword abstrak ("business analytics",
// "growth") yang di Pexels/Pixabay balik hasil trading/crypto/stock chart - relevan
// secara KEYWORD tapi salah secara MAKNA utk konten UMKM/marketing Agustap.
//
// REUSE penuh: deriveBrollKeywordsFromScript (fallback fail-open), searchBrollVideo/
// searchPexelsVideo/searchPixabayVideo (query lewat SINI, TIDAK diganti - cuma dapat
// query yang lebih baik + blocklist opsional, lihat blockTitleKeywords param baru di
// pexels.ts/pixabay.ts/broll.ts). TIDAK ada Pexels integration/asset pipeline kedua.
//
// Isolasi (PRD §26): dipanggil HANYA dari call site yang sudah cek
// isAgustapExtensionActive(brand.knowledgeSite) - brand lain TETAP pakai
// deriveBrollKeywordsFromScript polos, 0 perubahan.

// Slug URL Pexels/Pixabay biasanya derivatif judul asli (mis.
// ".../video/stock-market-chart-1234567/") - dash-separated. Dicek dalam bentuk asli
// (dash) DAN versi spasi, supaya cocok baik format URL maupun kalau suatu saat title
// mentah (bukan slug) yang diperiksa.
export const AGUSTAP_FINANCIAL_BLOCKLIST = [
  "trading", "forex", "crypto", "cryptocurrency", "bitcoin", "stock-market", "stock market",
  "stock-exchange", "stock exchange", "candlestick", "broker", "hedge-fund", "hedge fund",
  "investment-bank", "investment bank", "wall-street", "wall street", "trader",
];

export function isFootageUrlBlocked(pageUrl: string, blockTitleKeywords: string[]): boolean {
  if (blockTitleKeywords.length === 0) return false;
  const lower = pageUrl.toLowerCase();
  return blockTitleKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export type AgustapBrollQuery = { query: string; blockTitleKeywords: string[] };

/**
 * PRD §6 (context extraction) + §7 (contextual query) + §9 test 4 (trading TETAP boleh
 * kalau topiknya memang trading - TIDAK ada global ban, cuma scoped ke Agustap +
 * konteks non-finansial). SATU panggilan LLM (bukan 2 - extract lalu query terpisah),
 * fail-open ke deriveBrollKeywordsFromScript polos + blocklist default-ON kalau parsing
 * gagal (default aman: default MENOLAK footage finansial kecuali eksplisit relevan).
 */
export async function deriveAgustapBrollQuery(script: string, broaden: boolean = false): Promise<AgustapBrollQuery> {
  const client = getOpenAIClient();
  const broadenInstruction = broaden
    ? " A NARROW search already returned too few results - broaden to a more general small-business/UMKM scene-type this time. "
    : "";

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Kamu memilih keyword pencarian stock footage utk konten Agustap Studio (jasa social media " +
            "management/content marketing utk UMKM/bisnis kecil). Konteks utama Agustap: UMKM, small business, " +
            "local business owner, social media marketing - BUKAN financial trading/investment, KECUALI topik " +
            "skrip MEMANG membahas trading/saham/crypto secara eksplisit (PRD test case: 'bisnis trading saham " +
            "perlu memahami risiko pasar' -> trading TETAP boleh). " +
            "Analisis skrip: BUSINESS_TYPE, TARGET_AUDIENCE, ACTION, ENVIRONMENT, MARKETING_CONTEXT. " +
            "Kata abstrak seperti 'business'/'growth'/'analytics'/'performance' SENDIRIAN tidak cukup - " +
            "hasilkan keyword KONKRET (mis. 'small business owner smartphone', 'cafe owner social media', " +
            "'content creator checking analytics') bukan 'business growth' atau 'business analytics' polos " +
            "(istilah itu di Pexels/Pixabay sering balik hasil stock market/trading chart, SALAH konteks). " +
            broadenInstruction +
            "\n\nBalas PERSIS 2 baris:\nKEYWORDS: <2-4 kata Inggris konkret>\nFINANCIAL_CONTEXT: yes atau no",
        },
        { role: "user", content: script },
      ],
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    const keywordsMatch = raw.match(/KEYWORDS:\s*(.+)/i);
    const financialMatch = raw.match(/FINANCIAL_CONTEXT:\s*(yes|no)/i);
    const query = keywordsMatch?.[1]?.trim();
    if (!query) throw new Error("Gagal parse KEYWORDS dari respons");

    const financialContextAllowed = financialMatch?.[1]?.toLowerCase() === "yes";
    return {
      query,
      blockTitleKeywords: financialContextAllowed ? [] : AGUSTAP_FINANCIAL_BLOCKLIST,
    };
  } catch (err) {
    console.error("[agustap] deriveAgustapBrollQuery gagal, fallback ke deriveBrollKeywordsFromScript + blocklist default-ON:", err);
    const fallbackQuery = await deriveBrollKeywordsFromScript(script, broaden);
    // Default aman kalau parsing/LLM gagal: BLOKIR footage finansial (§10) - risiko
    // false-positive (skrip Agustap yg genuinely soal trading, sangat jarang) jauh
    // lebih kecil drpd risiko nyata (candlestick chart muncul di konten UMKM).
    return { query: fallbackQuery, blockTitleKeywords: AGUSTAP_FINANCIAL_BLOCKLIST };
  }
}
