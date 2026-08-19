// Content Similarity Threshold (PRD §38) - pure functions, tanpa dependency DB.
// Pisah dari contentSimilarity.ts supaya bisa di-import dari client components
// tanpa menarik better-sqlite3 ke bundle browser.

export type SimilarityTier = "safe" | "review" | "high" | "regenerate";

const SIMILARITY_THRESHOLDS = {
  safe: 40,
  review: 60,
  high: 75,
};

export function getSimilarityTier(score: number): SimilarityTier {
  if (score <= SIMILARITY_THRESHOLDS.safe) return "safe";
  if (score <= SIMILARITY_THRESHOLDS.review) return "review";
  if (score <= SIMILARITY_THRESHOLDS.high) return "high";
  return "regenerate";
}

export const SIMILARITY_TIER_LABELS: Record<SimilarityTier, string> = {
  safe: "Aman",
  review: "Perlu Review",
  high: "High Similarity",
  regenerate: "Wajib Regenerate",
};

export const SIMILARITY_TIER_COLORS: Record<SimilarityTier, string> = {
  safe: "bg-green-100 text-green-800",
  review: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  regenerate: "bg-red-100 text-red-800",
};
