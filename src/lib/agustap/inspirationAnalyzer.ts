import { getOpenAIClient } from "@/lib/ai/openaiClient";

// Inspiration Analyzer (PRD Agustap Studio Content Intelligence §13, §15-16) - SATU
// modul genuinely baru yang diidentifikasi docs/REUSE_MAP.md (semua modul lain
// PRD ini punya padanan existing yang tinggal di-extend). Tugasnya SEMPIT &
// isolated: terima referensi konten creator (URL atau input manual), keluarkan
// PRINSIP terstruktur (hook/angle/pacing/dst) - BUKAN transformasi ke konsep
// Agustap (itu tugas Phase 3, extend trendAdaptation.ts sesuai REUSE_MAP §17) dan
// BUKAN generate script (§14 - dilarang keras copy).
//
// Brand isolation (PRD §7): modul ini TIDAK melakukan guard sendiri - pemanggil
// (route/handler) WAJIB cek isAgustapExtensionActive() dulu sebelum memanggil
// fungsi apa pun di sini, sama seperti pola modul lain di project ini yang tidak
// menyisipkan auth/guard di layer service.

export type InspirationInput = {
  referenceUrl?: string;
  /** Fallback manual (PRD §16) kalau referenceUrl tidak bisa diakses/tidak ada. */
  transcript?: string;
  screenshotDescription?: string;
  summary?: string;
  creatorName?: string;
  userNote?: string;
};

export type InspirationPrinciples = {
  hookPattern: string;
  topic: string;
  angle: string;
  problemFraming: string;
  curiosityMechanism: string;
  storytellingStructure: string;
  pacing: string;
  educationalStructure: string;
  ctaPattern: string;
  psychology: string;
};

export type InspirationAnalysisResult =
  | { ok: true; principles: InspirationPrinciples; sourceUsed: "url" | "transcript" | "summary" | "screenshot" }
  | { ok: false; error: "SOURCE_UNAVAILABLE"; detail: string };

// Timeout pendek (PRD tidak minta browsing/JS-rendering penuh - kebanyakan
// referensi creator asli [TikTok/Instagram Reels/YouTube Shorts] JS-rendered atau
// diblok fetch polos, JADI fetch ini realistis HANYA berhasil utk halaman statis
// [artikel, blog, transcript publik] - kegagalan fetch BUKAN bug, itu memang
// batas real fetch tanpa headless browser, ditangani sbg SOURCE_UNAVAILABLE sesuai
// §16, bukan dipaksa/di-mock seolah berhasil).
const FETCH_TIMEOUT_MS = 10_000;
const MAX_FETCHED_CHARS = 12_000;

export async function fetchReferenceText(url: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "URL tidak valid" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: "URL harus http/https" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KontenPilotBot/1.0)" },
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const html = await res.text();
    // Ekstraksi teks minimal (strip tag/script/style) - CUKUP utk halaman statis
    // (artikel/blog/transcript). Tidak ada rendering JS - konten yang butuh JS
    // (mayoritas short-form video platform) akan menghasilkan teks nyaris kosong,
    // itu sinyal SOURCE_UNAVAILABLE (dicek di bawah), bukan dipaksa dianalisis.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 200) {
      return { ok: false, reason: "Konten halaman terlalu sedikit/kosong (kemungkinan butuh JS rendering)" };
    }
    return { ok: true, text: text.slice(0, MAX_FETCHED_CHARS) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "fetch gagal" };
  } finally {
    clearTimeout(timer);
  }
}

export function resolveSourceContent(
  input: InspirationInput,
  fetched: { ok: true; text: string } | { ok: false; reason: string } | null
): { content: string; sourceUsed: "url" | "transcript" | "summary" | "screenshot" } | null {
  if (fetched?.ok) return { content: fetched.text, sourceUsed: "url" };
  if (input.transcript && input.transcript.trim().length >= 50) {
    return { content: input.transcript.trim(), sourceUsed: "transcript" };
  }
  if (input.summary && input.summary.trim().length >= 20) {
    return { content: input.summary.trim(), sourceUsed: "summary" };
  }
  if (input.screenshotDescription && input.screenshotDescription.trim().length >= 20) {
    return { content: input.screenshotDescription.trim(), sourceUsed: "screenshot" };
  }
  return null;
}

/**
 * PRD §15 pipeline tahap REFERENCE -> ANALYZE -> EXTRACT PRINCIPLES. Tahap
 * AGUSTAP CONTEXT/TRANSFORM/ORIGINALITY CHECK ada di luar modul ini (Phase 3,
 * extend trendAdaptation.ts + reuse projects.similarity_score - lihat
 * docs/REUSE_MAP.md §17-18).
 */
export async function analyzeInspiration(input: InspirationInput): Promise<InspirationAnalysisResult> {
  const fetched = input.referenceUrl ? await fetchReferenceText(input.referenceUrl) : null;
  const resolved = resolveSourceContent(input, fetched);

  if (!resolved) {
    // §16: jangan mengarang isi kalau reference tidak bisa diakses & tidak ada
    // fallback manual apa pun yang layak.
    const detail = fetched && !fetched.ok
      ? `Reference URL tidak bisa diakses/dianalisis (${fetched.reason}). Masukkan transcript, ` +
        "screenshot description, atau summary manual sebagai fallback."
      : "Tidak ada reference URL, transcript, screenshot description, atau summary yang cukup " +
        "utk dianalisis.";
    return { ok: false, error: "SOURCE_UNAVAILABLE", detail };
  }

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Kamu analis konten yang mempelajari PRINSIP dari konten creator, BUKAN " +
          "meniru/copy kontennya. Dari teks referensi di bawah (transcript/deskripsi/" +
          "summary konten creator), ekstrak MEKANISME di baliknya - hook pattern, topic, " +
          "angle, problem framing, curiosity mechanism, storytelling structure, pacing, " +
          "educational structure, CTA pattern, psychology. JANGAN PERNAH kutip/parafrase " +
          "kalimat asli secara panjang - deskripsikan MEKANISME-nya dalam kata-katamu " +
          "sendiri, singkat & actionable (maks 25 kata per field). Kalau satu aspek " +
          "genuinely tidak ada/tidak jelas dari teks, isi string kosong \"\" - JANGAN " +
          "mengarang.",
      },
      {
        role: "user",
        content:
          (input.creatorName ? `Creator: ${input.creatorName}\n` : "") +
          (input.userNote ? `Catatan user: ${input.userNote}\n` : "") +
          `\nTeks referensi:\n${resolved.content}\n\n` +
          `Balas HARUS JSON valid (tanpa markdown code fence): {"hookPattern": "...", ` +
          `"topic": "...", "angle": "...", "problemFraming": "...", "curiosityMechanism": "...", ` +
          `"storytellingStructure": "...", "pacing": "...", "educationalStructure": "...", ` +
          `"ctaPattern": "...", "psychology": "..."}`,
      },
    ],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  try {
    const parsed = JSON.parse(cleaned);
    const principles: InspirationPrinciples = {
      hookPattern: str(parsed.hookPattern),
      topic: str(parsed.topic),
      angle: str(parsed.angle),
      problemFraming: str(parsed.problemFraming),
      curiosityMechanism: str(parsed.curiosityMechanism),
      storytellingStructure: str(parsed.storytellingStructure),
      pacing: str(parsed.pacing),
      educationalStructure: str(parsed.educationalStructure),
      ctaPattern: str(parsed.ctaPattern),
      psychology: str(parsed.psychology),
    };
    return { ok: true, principles, sourceUsed: resolved.sourceUsed };
  } catch {
    return {
      ok: false,
      error: "SOURCE_UNAVAILABLE",
      detail: "AI gagal menghasilkan analisis terstruktur dari referensi ini - coba lagi atau ganti sumber.",
    };
  }
}
