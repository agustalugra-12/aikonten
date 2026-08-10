import { getOpenAIClient } from "./openaiClient";

// Graphic Overlay - Stat Card (2026-08-10, permintaan Agus - preset editing "AI
// EDITING PRESET v2" Animal Story & Co, section GRAPHICS: "Weight/Height/Speed/
// Habitat/Diet/... Never clutter the screen"). PENTING (anti-halusinasi, prinsip yg
// sama dipakai di seluruh project ini - fact-check AI Blog dst): fungsi ini TIDAK
// PERNAH "mengarang" angka baru - GPT diminta cuma EKSTRAK stat yg SUDAH ADA di teks
// narasi (narasi itu sendiri sudah lewat proses generate/fact-constraint terpisah),
// bukan sumber fakta baru. Kalau tidak ada stat eksplisit disebut, hasilnya array
// kosong - TIDAK ADA overlay dipaksakan.
// Ikon (2026-08-10, permintaan Agus lanjutan - "Overlay System PRD" Category A minta
// field "icon") - SET TETAP (bukan GPT pilih bebas nama file) - 10 kategori umum +
// "default" fallback, semua di-download SEKALI dari Lucide (ISC license, SVG vektor
// polos - BUKAN color-emoji font yg terbukti gagal render sebelumnya, lihat
// stickerOverlay.ts) & di-rasterize ke PNG putih di repo (src/lib/render/assets/icons).
export type StatIconCategory =
  | "weight" | "speed" | "habitat" | "diet" | "lifespan"
  | "danger" | "population" | "size" | "species" | "temperature" | "default";
const VALID_ICON_CATEGORIES: StatIconCategory[] = [
  "weight", "speed", "habitat", "diet", "lifespan",
  "danger", "population", "size", "species", "temperature", "default",
];

export type StatOverlay = {
  label: string; // mis. "Weight", "Top Speed", "Habitat"
  value: string; // PERSIS spt disebut di narasi, mis. "200kg", "60 mph"
  positionFraction: number; // 0-1, posisi relatif di linimasa narasi
  iconCategory: StatIconCategory;
};

const MAX_STATS = 3; // "Never clutter the screen" - cap kecil, bukan tiap fakta jadi kartu

export async function extractStatOverlays(script: string): Promise<StatOverlay[]> {
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are extracting factual stat call-outs from a narration script for on-screen graphic overlays " +
            `(like a documentary infographic). Find UP TO ${MAX_STATS} concrete, numeric or short-factual stats ` +
            "EXPLICITLY stated in the text (weight, height, speed, length, lifespan, population, habitat, diet, " +
            "danger level, country/location, or similar measurable facts). Do NOT invent, estimate, or infer any " +
            "number or fact that is not literally stated in the text - if the script has no such explicit stats, " +
            "return an empty list. For each stat, give a short label (1-3 words, e.g. \"Top Speed\", \"Weight\", " +
            "\"Habitat\"), the value exactly as stated (short, e.g. \"70 mph\", \"200kg\", \"Pacific Ocean\"), and " +
            "positionFraction (0.0-1.0) estimating where in the narration this fact is mentioned (0=start, 1=end), " +
            `and iconCategory - pick the SINGLE closest match from this FIXED list only: ${VALID_ICON_CATEGORIES.join(", ")} ` +
            '(use "default" if nothing fits well - do not invent a new category name). ' +
            "IMPORTANT: label and value must NOT contain apostrophes or contractions (rephrase if needed, e.g. " +
            "use \"do not\" never \"don't\") - these render as on-screen text overlays with strict formatting. " +
            'Reply ONLY with JSON: {"stats": [{"label": string, "value": string, "positionFraction": number, "iconCategory": string}, ...]}.',
        },
        { role: "user", content: script },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    if (!Array.isArray(parsed.stats)) return [];
    return parsed.stats
      .filter(
        (s: unknown): s is StatOverlay =>
          typeof s === "object" && s !== null &&
          typeof (s as StatOverlay).label === "string" && (s as StatOverlay).label.length > 0 &&
          typeof (s as StatOverlay).value === "string" && (s as StatOverlay).value.length > 0 &&
          typeof (s as StatOverlay).positionFraction === "number"
      )
      // Buang apostrof kalau GPT tetap lolos meski sudah diinstruksikan (2026-08-10,
      // bug nyata ditemukan sblm ini di CTA text - pertahanan lapis kedua, bukan
      // percaya instruksi prompt 100%) - ganti jadi tanpa apostrof drpd reject total.
      // iconCategory divalidasi ke daftar TETAP (2026-08-10) - GPT kadang balikin
      // kategori di luar daftar meski diinstruksikan, fallback "default" drpd crash
      // nyari file PNG yg tidak ada.
      .map((s: StatOverlay) => ({
        ...s,
        label: s.label.replace(/'/g, ""),
        value: s.value.replace(/'/g, ""),
        iconCategory: VALID_ICON_CATEGORIES.includes(s.iconCategory) ? s.iconCategory : "default",
      }))
      .slice(0, MAX_STATS);
  } catch (err) {
    console.error("[statExtractor] gagal ekstrak stat, lanjut tanpa graphic overlay:", err);
    return [];
  }
}
