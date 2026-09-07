import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSimilarityTier } from "./similarityTier";
import { getOverusedHashtags } from "./hashtagTracking";
import { parseRetentionRisks } from "./contentBrief";

// Pre-Publishing Quality Control (PRD §37) - check kualitas sebelum publish.
// Deterministic checks, bukan AI-based (murah, cepat).
//
// Konsolidasi (2026-09-07, audit "AI Konten Fase 7-10" §10.8 - "QC 10 dimensi") - Retention
// Risk (retentionIntelligence.ts) & Fact Check (factCheck.ts) SUDAH dihitung & DISIMPAN
// sejak produksi (processProject.ts, kolom projects.retentionRisks/factCheckConfidence/
// factCheckFlags) tapi TIDAK PERNAH muncul di laporan QC ini - staf yang review draft harus
// buka 2 tempat terpisah utk lihat gambar lengkap. Di sini MURNI BACA ULANG data yang sudah
// ada (bukan panggilan AI baru, nol biaya tambahan), disatukan ke 1 laporan QCResult.

export type QCCheck = {
  name: string;
  passed: boolean;
  message: string;
  severity: "info" | "warning" | "error";
};

export type QCResult = {
  checks: QCCheck[];
  passed: boolean; // true kalau TIDAK ADA error
  score: number; // 0-100
};

export async function runPrePublishQC(
  brandId: string,
  project: {
    id: string;
    generatedCaption?: string | null;
    generatedHashtags?: string | null;
    similarityScore?: number | null;
    pillar?: string | null;
    retentionRisks?: string | null;
    factCheckConfidence?: number | null;
    factCheckFlags?: string | null;
  }
): Promise<QCResult> {
  const checks: QCCheck[] = [];

  // 1. Caption existence
  const hasCaption = !!project.generatedCaption && project.generatedCaption.length > 10;
  checks.push({
    name: "Caption Length",
    passed: hasCaption,
    message: hasCaption ? "Caption ada & cukup panjang" : "Caption kosong atau terlalu pendek",
    severity: hasCaption ? "info" : "error",
  });

  // 2. Similarity check
  const similarity = project.similarityScore ?? 0;
  const tier = getSimilarityTier(similarity);
  const similarityOK = tier === "safe" || tier === "review";
  checks.push({
    name: "Content Similarity",
    passed: similarityOK,
    message: `Similarity: ${similarity}% (${tier})${!similarityOK ? " - TERLALU MIRIP dengan konten sebelumnya" : ""}`,
    severity: similarityOK ? "info" : tier === "high" ? "warning" : "error",
  });

  // 3. Hashtag check
  const hashtags = project.generatedHashtags ? JSON.parse(project.generatedHashtags) : [];
  const hasHashtags = hashtags.length >= 2;
  checks.push({
    name: "Hashtag Count",
    passed: hasHashtags,
    message: hasHashtags ? `${hashtags.length} hashtags` : "Kurang dari 2 hashtags",
    severity: hasHashtags ? "info" : "warning",
  });

  // 4. Overused hashtags check
  const overused = await getOverusedHashtags(brandId);
  const hashtagOverlap = hashtags.filter((h: string) => overused.includes(h.toLowerCase().replace(/^#+/, "")));
  const hashtagOK = hashtagOverlap.length === 0;
  checks.push({
    name: "Hashtag Repetition",
    passed: hashtagOK,
    message: hashtagOK ? "Tidak ada hashtag overused" : `Hashtag overused: ${hashtagOverlap.join(", ")}`,
    severity: hashtagOK ? "info" : "warning",
  });

  // 5. Pillar check
  const hasPillar = !!project.pillar;
  checks.push({
    name: "Content Pillar",
    passed: hasPillar,
    message: hasPillar ? `Pillar: ${project.pillar}` : "Pillar belum diklasifikasikan",
    severity: hasPillar ? "info" : "warning",
  });

  // 6. CTA check
  const caption = (project.generatedCaption || "").toLowerCase();
  const hasCTA = /chat\s*admin|hubungi|wa\s*admin|pesan|booking|kunjungi/i.test(caption);
  checks.push({
    name: "CTA Presence",
    passed: hasCTA,
    message: hasCTA ? "CTA ada di caption" : "Tidak ada CTA di caption",
    severity: hasCTA ? "info" : "warning",
  });

  // 7. Retention Risk (2026-09-07, konsolidasi §10.8) - dihitung produksi (processProject.ts,
  // retentionIntelligence.ts), dibaca ulang di sini, bukan dihitung ulang.
  const retentionRisks = parseRetentionRisks(project.retentionRisks ?? null);
  const retentionOK = retentionRisks.length === 0;
  checks.push({
    name: "Retention Risk",
    passed: retentionOK,
    message: retentionOK ? "Tidak ada risiko retensi terdeteksi" : retentionRisks.join("; "),
    severity: retentionOK ? "info" : "warning",
  });

  // 8. Fact Check / Accuracy (2026-09-07, konsolidasi §10.8) - dihitung produksi
  // (factCheck.ts, warning-only by design - lihat priceValidator.ts kenapa - jadi severity
  // di sini paling tinggi "warning", bukan "error", konsisten dgn filosofi asalnya).
  // confidence null = brand tanpa Knowledge Base, tidak pernah dicek - BUKAN kegagalan.
  const factCheckFlags: string[] = (() => {
    if (!project.factCheckFlags) return [];
    try {
      const parsed = JSON.parse(project.factCheckFlags);
      return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : [];
    } catch {
      return [];
    }
  })();
  const factCheckSkipped = project.factCheckConfidence == null;
  const factCheckOK = factCheckSkipped || factCheckFlags.length === 0;
  checks.push({
    name: "Fact Check",
    passed: factCheckOK,
    message: factCheckSkipped
      ? "Tidak dicek (brand belum punya Knowledge Base)"
      : factCheckOK
        ? `Confidence ${project.factCheckConfidence}% - tidak ada klaim tak-didukung`
        : `Confidence ${project.factCheckConfidence}% - klaim perlu dicek: ${factCheckFlags.join("; ")}`,
    severity: factCheckOK ? "info" : "warning",
  });

  const passed = !checks.some((c) => c.severity === "error");
  const score = Math.round(
    checks.filter((c) => c.passed).length / checks.length * 100
  );

  return { checks, passed, score };
}
