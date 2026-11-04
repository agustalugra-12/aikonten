// Input representatif jalur LAMA buildComposition (dipakai golden/snapshot test Tahap 6).
import type { HfCompositionInput } from "../src/lib/render/hyperframesComposition";
const words = "Liburan tenang di tengah Ubud dengan kolam renang dan sarapan Bali setiap pagi. Booking sekarang!".split(" ")
  .map((w, i) => ({ word: w, start: i * 0.42, end: i * 0.42 + 0.34 }));
const clips = [{ videoUrl: "https://r2.example/a.mp4", durationSeconds: 6 }, { videoUrl: "https://r2.example/b.mp4", durationSeconds: 3.2, mediaStart: 4.5 }, { videoUrl: "https://r2.example/c.mp4", durationSeconds: 8, mediaStart: 1 }];
export const GOLDEN_INPUTS: Record<string, HfCompositionInput> = {
  full: { orientation: "portrait", brand: { primary: "#123456", accent: "#FFD84D", ink: "#FFFFFF", cta: "#CC1F1F", font: "Poppins", mark: "PELANGI" }, hook: "Liburan tenang di tengah Ubud dengan kolam renang yang indah", clips, audioUrl: "https://r2.example/vo.mp3", musicUrl: "https://r2.example/m.mp3", audioDurationSeconds: 7, words, cta: "Booking via WhatsApp", stats: [{ label: "per malam", value: "Rp350.000" }, { label: "menit ke Ubud", value: "5" }], lowerThird: { title: "Pelangi", subtitle: "Ubud", atSeconds: 1.2, durationSeconds: 4 }, look: "warm", pacing: "fast", emphasisPhrases: ["kolam renang", "sarapan Bali"] },
  faceless: { orientation: "square", hook: "Fakta gurita", audioDurationSeconds: 5, words: words.slice(0, 8), look: "mono", pacing: "calm" },
  landscape: { orientation: "landscape", clips: clips.slice(0, 1), audioDurationSeconds: 12, words, stat: { label: "jantung", value: "3" }, look: "cinematic" },
  empty: {},
};
