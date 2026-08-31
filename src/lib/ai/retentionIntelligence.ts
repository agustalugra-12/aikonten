import { WORDS_PER_SECOND } from "./generateContent";
import { getSimilarityTier } from "./similarityTier";

// Retention Intelligence (PRD §14, Task Plan 7) - fungsi MURNI, deterministic, TANPA
// panggilan AI baru - semua sinyal input SUDAH dihitung di tempat lain (structureTemplate/
// hookType overuse dari contentVariety.ts, similarityScore dari contentSimilarity.ts) di
// generation time yg SAMA, cuma belum pernah dirangkai jadi peringatan risiko retensi.
// Estimasi durasi HOOK murni dari jumlah kata (WORDS_PER_SECOND, sama konstanta dgn
// generateContent.ts) - kasar tapi konsisten, tidak perlu analisis audio/video sungguhan.

// Threshold hook (2026-08-26) - video pendek (<=60dtk, TikTok/Reels/Shorts) butuh hook
// LEBIH SINGKAT drpd video panjang (YouTube long-form) - audiens short-form video scroll
// lebih cepat, toleransi intro lebih rendah.
const SHORT_VIDEO_HOOK_MAX_SECONDS = 5;
const LONG_VIDEO_HOOK_MAX_SECONDS = 8;
const LONG_VIDEO_THRESHOLD_SECONDS = 60;

export function analyzeRetentionRisk(input: {
  hookText: string | null;
  totalDurationSeconds: number;
  hookType: string | null;
  structureOverused: boolean;
  hookTypeOverused: boolean;
  similarityScore: number | null;
}): string[] {
  const risks: string[] = [];

  if (input.hookText) {
    const wordCount = input.hookText.trim().split(/\s+/).filter(Boolean).length;
    const hookSeconds = wordCount / WORDS_PER_SECOND;
    const maxSeconds = input.totalDurationSeconds <= LONG_VIDEO_THRESHOLD_SECONDS
      ? SHORT_VIDEO_HOOK_MAX_SECONDS
      : LONG_VIDEO_HOOK_MAX_SECONDS;
    if (hookSeconds > maxSeconds) {
      risks.push(`Intro terlalu panjang (~${Math.round(hookSeconds)}dtk) - informasi utama berpotensi terlambat, audiens bisa scroll duluan.`);
    }
  }

  if (!input.hookType) {
    risks.push("Hook tidak jelas kategorinya (klasifikasi gagal) - curiosity gap di 3 detik pertama berpotensi lemah.");
  }

  if (input.structureOverused || input.hookTypeOverused) {
    risks.push("Struktur/hook mirip video-video terakhir - resiko terasa monoton buat audiens yg sering lihat konten brand ini.");
  }

  if (input.similarityScore != null) {
    const tier = getSimilarityTier(input.similarityScore);
    if (tier === "high" || tier === "regenerate") {
      risks.push("Konten mirip konten sebelumnya (similarity tinggi) - bisa terasa berulang, retensi berpotensi lebih rendah dari biasanya.");
    }
  }

  return risks;
}
