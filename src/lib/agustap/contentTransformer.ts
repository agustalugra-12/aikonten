import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { embedText, cosineSimilarity } from "@/lib/ai/contentSimilarity";
import { getSimilarityTier, type SimilarityTier } from "@/lib/ai/similarityTier";
import type { InspirationPrinciples } from "./inspirationAnalyzer";

// Content Transformer + Originality Check (PRD Agustap Studio §17-18, Phase 3).
// REUSE penuh infrastruktur existing (docs/REUSE_MAP.md §17-18) - TIDAK membangun
// mesin originality baru:
// - embedText/cosineSimilarity (src/lib/ai/contentSimilarity.ts) - dipakai APA
//   ADANYA, cuma dibandingkan SOURCE (prinsip inspirasi) vs HASIL TRANSFORM
//   (beda use-case dari checkContentSimilarity yang bandingkan proyek baru vs
//   histori brand sendiri - tapi MEKANISME-nya [embed+cosine] identik, reuse
//   fungsi murninya, bukan reimplementasi).
// - getSimilarityTier (src/lib/ai/similarityTier.ts) - threshold 0-100 yang SUDAH
//   dipakai konsisten di seluruh app ("high"/"regenerate" = wajib rewrite,
//   PRD §18 "Too similar? -> Rewrite").
//
// Brand isolation: modul ini TIDAK guard sendiri - pemanggil WAJIB cek
// isAgustapExtensionActive() dulu (pola sama dgn inspirationAnalyzer.ts).

export type AgustapBrandDNA = {
  positioning: string;
  toneOfVoice: string;
  targetAudience: string;
};

export type ContentTransformResult = {
  concept: string;
  angle: string;
  audienceNote: string;
  wordingNote: string;
  visualNote: string;
  ctaDirection: string;
  /** 0-100 vs source (prinsip inspirasi) - REUSE skala similarityScore existing. */
  originalitySimilarityScore: number;
  originalityTier: SimilarityTier;
  /** True kalau hasil pertama terlalu mirip source & sudah di-rewrite 1x (§18). */
  rewritten: boolean;
};

function sourceConceptText(principles: InspirationPrinciples): string {
  return [principles.topic, principles.angle, principles.hookPattern]
    .filter((s) => s && s.trim().length > 0)
    .join(". ");
}

async function callTransformLLM(
  brandName: string,
  dna: AgustapBrandDNA,
  principles: InspirationPrinciples,
  userNote: string | undefined,
  rewriteHint: string | null
): Promise<Omit<ContentTransformResult, "originalitySimilarityScore" | "originalityTier" | "rewritten"> | null> {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          `Kamu content strategist untuk brand "${brandName}". Positioning: ${dna.positioning}. ` +
          `Target audience: ${dna.targetAudience}. Tone of voice: ${dna.toneOfVoice}.\n\n` +
          "TUGAS: dari PRINSIP (mekanisme) hasil analisis konten creator lain di bawah, buat " +
          "SATU konsep konten ORIGINAL untuk brand ini. WAJIB ubah SEMUA dari berikut " +
          "dibanding sumber aslinya (PRD §17): angle, audience framing, contoh/examples, " +
          "wording, arahan visual, dan CTA - JANGAN cuma ganti kata dari topik yang sama. " +
          "DILARANG KERAS mengutip/parafrase kalimat asli creator sumber (kamu cuma diberi " +
          "PRINSIP/mekanisme, bukan teks asli, jadi ini seharusnya otomatis aman selama kamu " +
          "benar2 membangun dari mekanisme, bukan menebak-nebak kalimat aslinya).",
      },
      {
        role: "user",
        content:
          "PRINSIP DARI REFERENSI (mekanisme, bukan konten asli):\n" +
          `- Hook pattern: ${principles.hookPattern || "-"}\n` +
          `- Topic: ${principles.topic || "-"}\n` +
          `- Angle: ${principles.angle || "-"}\n` +
          `- Problem framing: ${principles.problemFraming || "-"}\n` +
          `- Curiosity mechanism: ${principles.curiosityMechanism || "-"}\n` +
          `- Storytelling structure: ${principles.storytellingStructure || "-"}\n` +
          `- Pacing: ${principles.pacing || "-"}\n` +
          `- Educational structure: ${principles.educationalStructure || "-"}\n` +
          `- CTA pattern: ${principles.ctaPattern || "-"}\n` +
          `- Psychology: ${principles.psychology || "-"}\n` +
          (userNote ? `\nCatatan tambahan user: ${userNote}\n` : "") +
          (rewriteHint ? `\nPENTING - REVISI: ${rewriteHint}\n` : "") +
          `\nBalas HARUS JSON valid (tanpa markdown code fence): {"concept": "ide konten ` +
          `1-2 kalimat", "angle": "...", "audienceNote": "kenapa relevan utk audience ` +
          `brand ini", "wordingNote": "gaya bahasa yang dipakai", "visualNote": "arahan ` +
          `visual singkat (faceless - Pexels/screen recording/motion graphics, TANPA ` +
          `talking head)", "ctaDirection": "..."}`,
      },
    ],
    temperature: 0.6,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  try {
    const parsed = JSON.parse(cleaned);
    if (!str(parsed.concept)) return null;
    return {
      concept: str(parsed.concept),
      angle: str(parsed.angle),
      audienceNote: str(parsed.audienceNote),
      wordingNote: str(parsed.wordingNote),
      visualNote: str(parsed.visualNote),
      ctaDirection: str(parsed.ctaDirection),
    };
  } catch {
    return null;
  }
}

/**
 * PRD §17-18: transform prinsip inspirasi jadi konsep original Agustap, lalu
 * originality check (embedding cosine similarity SOURCE vs HASIL) - kalau tier
 * "high"/"regenerate" (§18 "Too similar"), rewrite SATU kali dgn hint eksplisit
 * (bukan loop tanpa batas - 1x retry cukup, sama pola dgn guard lain project ini
 * yang menghindari retry-loop biaya tak terbatas).
 */
export async function transformInspirationToAgustapConcept(
  brandName: string,
  dna: AgustapBrandDNA,
  principles: InspirationPrinciples,
  userNote?: string
): Promise<ContentTransformResult | null> {
  const sourceText = sourceConceptText(principles);
  if (!sourceText) return null; // tidak ada apa pun utk ditransform - zero API cost

  const first = await callTransformLLM(brandName, dna, principles, userNote, null);
  if (!first) return null;

  const [sourceEmbedding, firstEmbedding] = await Promise.all([
    embedText(sourceText),
    embedText(first.concept),
  ]);
  let score = Math.round(cosineSimilarity(sourceEmbedding, firstEmbedding) * 100);
  let tier = getSimilarityTier(score);
  let final = first;
  let rewritten = false;

  if (tier === "high" || tier === "regenerate") {
    const retry = await callTransformLLM(
      brandName,
      dna,
      principles,
      userNote,
      "Konsep sebelumnya masih terlalu mirip sumber - ubah LEBIH JAUH lagi angle, " +
        "contoh, dan wording-nya, jangan cuma variasi kalimat."
    );
    if (retry) {
      const retryEmbedding = await embedText(retry.concept);
      const retryScore = Math.round(cosineSimilarity(sourceEmbedding, retryEmbedding) * 100);
      final = retry;
      score = retryScore;
      tier = getSimilarityTier(retryScore);
      rewritten = true;
    }
  }

  return { ...final, originalitySimilarityScore: score, originalityTier: tier, rewritten };
}
