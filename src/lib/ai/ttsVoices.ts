// Pilihan suara TTS (2026-11-02, T4 - permintaan Agus "pilihan suara dari tts... minimal
// 4-6 pilihan dan bisa di preview, di bagian brand kit"). Voice OpenAI gpt-4o-mini-tts
// (lihat dubbing.ts). SATU sumber kebenaran: dipakai dubbing (render), validateBrandKit
// (gerbang simpan), dan UI (dropdown + preview). Sample pra-render di public/tts-samples/<id>.mp3.

export type TtsVoiceId = "marin" | "alloy" | "echo" | "fable" | "nova" | "shimmer";

export const TTS_VOICES: { id: TtsVoiceId; label: string; desc: string }[] = [
  { id: "marin", label: "Marin", desc: "Natural & seimbang (default)" },
  { id: "alloy", label: "Alloy", desc: "Netral, jernih" },
  { id: "echo", label: "Echo", desc: "Hangat, cenderung pria" },
  { id: "fable", label: "Fable", desc: "Ekspresif, gaya bercerita" },
  { id: "nova", label: "Nova", desc: "Ceria, cenderung wanita" },
  { id: "shimmer", label: "Shimmer", desc: "Lembut, tenang" },
];

export const DEFAULT_TTS_VOICE: TtsVoiceId = "marin";

const VALID = new Set<string>(TTS_VOICES.map((v) => v.id));
export function isValidVoice(v: unknown): v is TtsVoiceId {
  return typeof v === "string" && VALID.has(v);
}
// Normalisasi: kembalikan voice valid atau default (jangan pernah lempar - fail-soft spt resolveBrandKit).
export function resolveVoice(v: unknown): TtsVoiceId {
  return isValidVoice(v) ? v : DEFAULT_TTS_VOICE;
}
