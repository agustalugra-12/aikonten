import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, desc, isNotNull, ne } from "drizzle-orm";
import { getOpenAIClient } from "./openaiClient";

// Originality/Duplicate Detector (2026-08-08, PRD "YouTube Content & Monetization
// Safety System" Section 9-10) - lihat catatan lengkap di schema.ts (projects.
// captionEmbedding/similarityScore) kenapa ini WARNING-ONLY dulu, bukan hard block.
//
// Window N project TERAKHIR (bukan SELURUH histori) - sama alasan dgn
// footageVariety.ts RECENT_PROJECTS_WINDOW: cukup utk tangkap pengulangan yang
// BERDEKATAN (paling sering dikeluhkan/terasa monoton), tanpa biaya query+compare yang
// terus membesar seiring histori brand bertambah panjang.
const RECENT_PROJECTS_WINDOW = 20;
const EMBEDDING_MODEL = "text-embedding-3-small"; // murah ($0.02/1M token) - caption pendek, biaya diabaikan

export async function embedText(text: string): Promise<number[]> {
  const client = getOpenAIClient();
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return res.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type SimilarityResult = {
  embedding: number[];
  similarityScore: number; // 0-100
  similarToProjectId: string | null;
};

// Dipanggil processProject.ts SETELAH caption final digenerate. Gagal embed (API
// error) tidak boleh menggagalkan generate video keseluruhan - pemanggil WAJIB
// bungkus try/catch & lanjut dgn embedding/skor null kalau ini throw (lihat komentar
// di processProject.ts).
export async function checkContentSimilarity(brandId: string, caption: string, excludeProjectId: string): Promise<SimilarityResult> {
  const embedding = await embedText(caption);

  const recent = await db
    .select({ id: projects.id, embedding: projects.captionEmbedding })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), isNotNull(projects.captionEmbedding), ne(projects.id, excludeProjectId)))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_PROJECTS_WINDOW);

  let best = { score: 0, id: null as string | null };
  for (const r of recent) {
    if (!r.embedding) continue;
    try {
      const otherEmbedding: number[] = JSON.parse(r.embedding);
      const score = cosineSimilarity(embedding, otherEmbedding);
      if (score > best.score) best = { score, id: r.id };
    } catch {
      continue; // baris korup/lama-format-beda - dilewati, bukan menggagalkan seluruh perbandingan
    }
  }

  return {
    embedding,
    similarityScore: Math.round(best.score * 100),
    similarToProjectId: best.id,
  };
}
