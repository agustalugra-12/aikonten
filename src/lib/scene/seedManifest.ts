// Seed Scene Manifest untuk editor (2026-10-28, Fase 5A - Timeline Foundation). MURNI, aman
// client (hanya impor modul sceneManifest yg sendiri murni). Menentukan manifest awal yg
// ditampilkan editor TANPA menulis DB:
//   - Manifest TERSIMPAN (Fase 4) ada & valid -> pakai itu (orientasi dari manifest).
//   - Proyek lama (scene_manifest NULL) -> seed in-memory dari clipSelection (footage+timing).
//     scene_manifest DB TETAP NULL sampai user Simpan (5E) -> perilaku render lama tak berubah.
//   - Tak ada clipSelection valid -> null (editor tampilkan state kosong).
import {
  resolveSceneManifest,
  buildManifestFromRenderInputs,
  type SceneManifest,
  type SceneOrientation,
} from "@/lib/render/sceneManifest";

export type SeedSource = "stored" | "seeded" | "empty";
export type SeedResult = { manifest: SceneManifest | null; source: SeedSource };

export type SeedInput = {
  sceneManifest?: string | null; // kolom DB (JSON string) dari GET /api/projects/[id]
  clipSelection?: string | null; // JSON array ScoredSegment (sourceUrl/start/end + skor)
  orientation: SceneOrientation; // orientasi brand (utk seed; diabaikan kalau manifest tersimpan)
};

export function seedManifestFromProject(input: SeedInput): SeedResult {
  const stored = resolveSceneManifest(input.sceneManifest);
  if (stored) return { manifest: stored, source: "stored" };

  const segments = parseClipSelectionSegments(input.clipSelection);
  if (segments.length === 0) return { manifest: null, source: "empty" };

  const manifest = buildManifestFromRenderInputs({ segments, orientation: input.orientation });
  return { manifest, source: "seeded" };
}

type SeedSegment = { sourceUrl: string; start: number; end: number };

// Ambil HANYA field yg dipakai renderer (sourceUrl/start/end) dari clipSelection; abaikan skor
// heuristik & entri cacat. Validasi rentang (0<=start<end) supaya seed selalu bisa dikompilasi.
function parseClipSelectionSegments(json: string | null | undefined): SeedSegment[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SeedSegment[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const { sourceUrl, start, end } = rec;
    if (
      typeof sourceUrl === "string" &&
      sourceUrl.length > 0 &&
      typeof start === "number" &&
      Number.isFinite(start) &&
      typeof end === "number" &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start
    ) {
      out.push({ sourceUrl, start, end });
    }
  }
  return out;
}
