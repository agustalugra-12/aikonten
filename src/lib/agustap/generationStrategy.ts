import { db } from "@/db";
import { competitors, type brands } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { embedText, cosineSimilarity } from "@/lib/ai/contentSimilarity";
import { getSimilarityTier, type SimilarityTier } from "@/lib/ai/similarityTier";
import { isAgustapExtensionActive } from "./featureFlag";
import type { InspirationPrinciples } from "./inspirationAnalyzer";
import type { CreatorBenchmarkProfile } from "./creatorBenchmark";
import type { AgustapBrandDNA } from "./contentTransformer";

// Generation Contract / Content Strategy (PRD Agustap Studio §2.4-2.8, §2.17,
// 2026-09-01). Titik gabung SATU-SATUNYA yang mengombinasikan Content DNA (Phase
// 1) + Creator Benchmark aktif (Phase 2, creatorBenchmark.ts) + Content
// Inspiration opsional (Phase 2, inspirationAnalyzer.ts) jadi 1 strategi konten,
// LALU diteruskan ke existing content generator (di luar modul ini - caller yang
// pegang generateContent.ts, sesuai §2.17 "Tidak membuat generator baru").
//
// Priority order §2.8 (dari tinggi ke rendah - dicerminkan LANGSUNG di urutan
// instruksi prompt system, bukan cuma komentar):
//   1. Agustap Content DNA
//   2. Topic/goal dari user
//   3. Content Inspiration spesifik (kalau user pilih satu)
//   4. Active Creator Benchmark (background intelligence, otomatis)
//   5. Generic AI knowledge (fallback LLM kalau semua di atas tipis)
//
// §2.7: kalau TIDAK ADA benchmark aktif MAUPUN inspiration, modul ini return null
// - caller pakai existing generator APA ADANYA (Agustap DNA sendiri sudah cukup
// dibaca dari kolom `brands`, tidak butuh Intelligence Layer ini sama sekali).

export type ActiveCreatorBenchmark = {
  name: string;
  role: string | null;
  profile: CreatorBenchmarkProfile;
};

export type AgustapContentStrategy = {
  concept: string;
  angle: string;
  audienceNote: string;
  wordingNote: string;
  visualNote: string;
  ctaDirection: string;
  /** §2.5 Relevance Filter - nama benchmark yang BENAR-BENAR dipakai (self-reported
   * model, bukan semua benchmark aktif otomatis dianggap dipakai). */
  benchmarksUsed: string[];
  inspirationUsed: boolean;
  originalitySimilarityScore: number | null;
  originalityTier: SimilarityTier | null;
  rewritten: boolean;
};

function benchmarkBlockText(b: ActiveCreatorBenchmark): string {
  return (
    `### ${b.name}${b.role ? ` (${b.role})` : ""}\n` +
    `Hook: ${b.profile.hookPattern}\nStorytelling: ${b.profile.storytellingPattern}\n` +
    `Angle: ${b.profile.contentAngle}\nPacing: ${b.profile.pacing}\nCTA: ${b.profile.ctaPattern}\n` +
    `Visual: ${b.profile.visualPattern}\nAudience: ${b.profile.audiencePattern}`
  );
}

function sourceTextForOriginality(
  inspiration: InspirationPrinciples | null | undefined,
  benchmarksUsedProfiles: ActiveCreatorBenchmark[]
): string {
  const parts: string[] = [];
  if (inspiration) {
    parts.push([inspiration.topic, inspiration.angle, inspiration.hookPattern].filter(Boolean).join(". "));
  }
  for (const b of benchmarksUsedProfiles) {
    parts.push([b.profile.contentAngle, b.profile.hookPattern].filter(Boolean).join(". "));
  }
  return parts.filter((p) => p.trim().length > 0).join(". ");
}

async function callStrategyLLM(
  brandName: string,
  dna: AgustapBrandDNA,
  topic: string,
  goal: string | undefined,
  activeBenchmarks: ActiveCreatorBenchmark[],
  contentInspiration: InspirationPrinciples | null | undefined,
  rewriteHint: string | null
): Promise<Omit<AgustapContentStrategy, "originalitySimilarityScore" | "originalityTier" | "rewritten"> | null> {
  const client = getOpenAIClient();
  const benchmarkBlocks = activeBenchmarks.map(benchmarkBlockText).join("\n\n");

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          `Kamu content strategist untuk brand "${brandName}". Susun SATU strategi konten ` +
          "dengan URUTAN PRIORITAS berikut (PRD §2.8, WAJIB diikuti persis urutannya):\n" +
          `1. AGUSTAP CONTENT DNA (paling utama, TIDAK BOLEH dikalahkan sumber lain):\n` +
          `   Positioning: ${dna.positioning}\n   Target audience: ${dna.targetAudience}\n` +
          `   Tone of voice: ${dna.toneOfVoice}\n` +
          `2. TOPIC/GOAL dari user: "${topic}"${goal ? ` (goal: ${goal})` : ""}\n` +
          (contentInspiration
            ? "3. CONTENT INSPIRATION spesifik (prinsip/mekanisme dari 1 konten referensi yang " +
              "user pilih - prioritas LEBIH TINGGI dari creator benchmark umum di bawah)\n"
            : "3. (tidak ada Content Inspiration spesifik utk giliran ini)\n") +
          (activeBenchmarks.length > 0
            ? "4. ACTIVE CREATOR BENCHMARK (background intelligence, PILIH HANYA yang " +
              "relevan dgn topic di atas - §2.5 Relevance Filter. Boleh gabung >1 benchmark " +
              "kalau memang relevan - §2.6 Multi-Benchmark - TAPI hasil akhir HARUS terasa " +
              "seperti konten Agustap, BUKAN gabungan gaya beberapa creator)\n"
            : "4. (tidak ada creator benchmark aktif)\n") +
          "5. Kalau DNA/topic/inspiration/benchmark semua tipis untuk aspek tertentu, " +
          "boleh isi dari pengetahuan umum kamu sbg fallback TERAKHIR.\n\n" +
          "ATURAN KERAS: kalau ada konflik antara Content Inspiration/Creator Benchmark " +
          "dengan Agustap DNA, AGUSTAP DNA MENANG (§2.7). Konten WAJIB faceless (Pexels/" +
          "screen recording/motion graphics, TANPA talking head/avatar). DILARANG mengutip/" +
          "parafrase kalimat asli creator - kamu cuma diberi PRINSIP/mekanisme, bukan teks asli.",
      },
      {
        role: "user",
        content:
          (contentInspiration
            ? "CONTENT INSPIRATION:\n" +
              `Hook: ${contentInspiration.hookPattern}\nAngle: ${contentInspiration.angle}\n` +
              `Problem framing: ${contentInspiration.problemFraming}\n` +
              `Curiosity: ${contentInspiration.curiosityMechanism}\n` +
              `Storytelling: ${contentInspiration.storytellingStructure}\nPacing: ${contentInspiration.pacing}\n` +
              `CTA: ${contentInspiration.ctaPattern}\nPsychology: ${contentInspiration.psychology}\n\n`
            : "") +
          (benchmarkBlocks ? `ACTIVE CREATOR BENCHMARKS:\n${benchmarkBlocks}\n\n` : "") +
          (rewriteHint ? `PENTING - REVISI: ${rewriteHint}\n\n` : "") +
          `Balas HARUS JSON valid (tanpa markdown code fence): {"concept": "ide konten ` +
          `1-2 kalimat", "angle": "...", "audienceNote": "...", "wordingNote": "...", ` +
          `"visualNote": "arahan visual faceless singkat", "ctaDirection": "...", ` +
          `"benchmarksUsed": ["nama creator yang BENAR-BENAR dipakai patternnya, array kosong ` +
          `kalau tidak ada yang relevan/dipakai"]}`,
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
      benchmarksUsed: Array.isArray(parsed.benchmarksUsed)
        ? parsed.benchmarksUsed.filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
        : [],
      inspirationUsed: !!contentInspiration,
    };
  } catch {
    return null;
  }
}

/**
 * §2.4-2.8/§2.17: bangun 1 Content Strategy dari DNA + benchmark aktif + inspirasi
 * opsional. Return null kalau tidak ada benchmark aktif MAUPUN inspiration (§2.7 -
 * caller pakai existing generator apa adanya, Intelligence Layer ini tidak relevan
 * dipanggil utk giliran ini - zero API cost).
 */
export async function buildAgustapContentStrategy(
  brandName: string,
  topic: string,
  dna: AgustapBrandDNA,
  activeBenchmarks: ActiveCreatorBenchmark[],
  contentInspiration?: InspirationPrinciples | null,
  goal?: string
): Promise<AgustapContentStrategy | null> {
  if (activeBenchmarks.length === 0 && !contentInspiration) return null;

  const first = await callStrategyLLM(brandName, dna, topic, goal, activeBenchmarks, contentInspiration, null);
  if (!first) return null;

  const usedBenchmarks = activeBenchmarks.filter((b) => first.benchmarksUsed.includes(b.name));
  const sourceText = sourceTextForOriginality(contentInspiration, usedBenchmarks);

  // Tidak ada sumber konkret yang benar2 dipakai (mis. model bilang tidak ada
  // benchmark relevan & tidak ada inspiration) - originality check tidak relevan,
  // skip (zero embedding cost tambahan).
  if (!sourceText) {
    return { ...first, originalitySimilarityScore: null, originalityTier: null, rewritten: false };
  }

  const [sourceEmbedding, conceptEmbedding] = await Promise.all([
    embedText(sourceText),
    embedText(first.concept),
  ]);
  let score = Math.round(cosineSimilarity(sourceEmbedding, conceptEmbedding) * 100);
  let tier = getSimilarityTier(score);
  let final = first;
  let rewritten = false;

  if (tier === "high" || tier === "regenerate") {
    const retry = await callStrategyLLM(
      brandName,
      dna,
      topic,
      goal,
      activeBenchmarks,
      contentInspiration,
      "Konsep sebelumnya masih terlalu mirip sumber (inspiration/benchmark) - ubah LEBIH " +
        "JAUH lagi angle, contoh, dan wording-nya, jangan cuma variasi kalimat."
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

type BrandRow = typeof brands.$inferSelect;

/**
 * Wiring adapter (2026-09-01) - SATU-SATUNYA titik yang menyambungkan Generation
 * Strategy ke pipeline nyata (src/lib/pipeline/autoContent.ts). Guard
 * isAgustapExtensionActive() dicek DI SINI (bukan dipercaya ke caller) - brand lain
 * manapun yang memanggil fungsi ini akan SELALU dapat `script` apa adanya kembali
 * tanpa perubahan (return awal secepat mungkin, zero query/API cost tambahan).
 *
 * Content Inspiration (spesifik, per-user-selection) SENGAJA belum diikutkan di
 * sini - belum ada API/UI utk user memilih 1 saved inspiration (di luar scope
 * "wiring tanpa API" permintaan Agus 2026-09-02). Creator Benchmark (otomatis,
 * §2.4) SUDAH diikutkan penuh - itu justru yang PRD minta jalan tanpa perlu user
 * pilih apa pun tiap generate.
 */
export async function applyAgustapStrategyIfActive(brand: BrandRow, script: string): Promise<string> {
  if (!isAgustapExtensionActive(brand.knowledgeSite)) return script;

  const activeRows = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.brandId, brand.id), eq(competitors.benchmarkActive, true)));

  const activeBenchmarks: ActiveCreatorBenchmark[] = [];
  for (const row of activeRows) {
    if (!row.benchmarkProfile) continue;
    try {
      activeBenchmarks.push({
        name: row.name,
        role: row.role,
        profile: JSON.parse(row.benchmarkProfile) as CreatorBenchmarkProfile,
      });
    } catch {
      continue; // profile korup/lama - dilewati, bukan menggagalkan generate keseluruhan
    }
  }

  // §2.7: tidak ada benchmark aktif (belum ada yang di-setup/di-aktifkan) -> zero
  // API cost tambahan, script existing dipakai apa adanya (sama seperti brand lain).
  if (activeBenchmarks.length === 0) return script;

  const dna: AgustapBrandDNA = {
    positioning: brand.positioning || "",
    toneOfVoice: brand.toneOfVoice || "",
    targetAudience: brand.targetAudience || "",
  };

  try {
    const strategy = await buildAgustapContentStrategy(brand.name, script, dna, activeBenchmarks, null);
    return strategy?.concept?.trim() || script;
  } catch (e) {
    // Kegagalan Intelligence Layer TIDAK BOLEH menggagalkan generate konten
    // keseluruhan (§43 Failure Isolation - "Agustap module error -> Core AI Konten
    // tetap hidup") - fallback ke script asli (idea generik existing), bukan throw.
    console.error("[agustap] applyAgustapStrategyIfActive gagal, fallback ke script asli:", e);
    return script;
  }
}
