// Operasi mutasi Scene Manifest untuk editor (2026-10-28, Fase 5B - Scene Management). MURNI &
// IMMUTABLE: tiap fungsi balikkan SceneManifest BARU (tak ubah argumen), mempertahankan
// version/orientation/overlays/audio/subtitlePresent/maxDurationSeconds. id scene baru DIPASOK
// pemanggil (UI pakai crypto.randomUUID; tes pakai id tetap) -> fungsi deterministik & teruji.
// Hasil tiap operasi dirancang tetap lolos validateSceneManifest (dipanggil lagi sbg otoritas
// sebelum save). Tak impor DB/ffmpeg -> aman client.
import type { Scene, SceneFootage, SceneManifest } from "@/lib/render/sceneManifest";

function withScenes(manifest: SceneManifest, scenes: Scene[]): SceneManifest {
  return { ...manifest, scenes };
}

export function addScene(manifest: SceneManifest, footage: SceneFootage, newId: string): SceneManifest {
  const scene: Scene = { id: newId, footage };
  return withScenes(manifest, [...manifest.scenes, scene]);
}

// Hapus scene. NO-OP kalau itu scene terakhir (manifest butuh >=1 scene; UI juga menonaktifkan
// tombol hapus saat tinggal 1) -> tak pernah hasilkan scenes kosong yg invalid.
export function removeScene(manifest: SceneManifest, sceneId: string): SceneManifest {
  if (manifest.scenes.length <= 1) return manifest;
  const scenes = manifest.scenes.filter((s) => s.id !== sceneId);
  if (scenes.length === manifest.scenes.length) return manifest; // id tak ditemukan
  return withScenes(manifest, scenes);
}

// Geser scene satu posisi. NO-OP kalau sudah di ujung atau id tak ada.
export function moveScene(manifest: SceneManifest, sceneId: string, direction: "up" | "down"): SceneManifest {
  const idx = manifest.scenes.findIndex((s) => s.id === sceneId);
  if (idx === -1) return manifest;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= manifest.scenes.length) return manifest;
  const scenes = [...manifest.scenes];
  [scenes[idx], scenes[target]] = [scenes[target], scenes[idx]];
  return withScenes(manifest, scenes);
}

// Ganti footage satu scene (mis. pilih klip lain dari Footage Bank). Motion/transisi scene
// dipertahankan. NO-OP kalau id tak ada.
export function setSceneFootage(manifest: SceneManifest, sceneId: string, footage: SceneFootage): SceneManifest {
  let found = false;
  const scenes = manifest.scenes.map((s) => {
    if (s.id !== sceneId) return s;
    found = true;
    return { ...s, footage };
  });
  return found ? withScenes(manifest, scenes) : manifest;
}

// Helper: footage broll dari item Footage Bank (durasi bisa null di DB -> fallback 5s karena
// broll butuh durationSeconds > 0).
export function brollFootageFromBank(fileUrl: string, durationSeconds?: number | null): SceneFootage {
  const dur = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 5;
  return { kind: "broll", videoUrl: fileUrl, durationSeconds: dur };
}

// --- Fase 5C: Clip Properties (trim segment / durasi broll) ---
// Hasil operasi tervalidasi: {ok:false,error} supaya UI tampilkan pesan inline TANPA memasukkan
// nilai invalid ke manifest (manifest selalu lolos validateSceneManifest).
export type EditResult = { ok: true; manifest: SceneManifest } | { ok: false; error: string };

// Trim segment: set start/end. Sumber (sourceUrl) & motion/transisi scene dipertahankan.
export function setSegmentTrim(manifest: SceneManifest, sceneId: string, start: number, end: number): EditResult {
  const scene = manifest.scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene tidak ditemukan." };
  if (scene.footage.kind !== "segment") return { ok: false, error: "Scene ini bukan klip segment." };
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "Start/end harus berupa angka." };
  if (start < 0) return { ok: false, error: "Start tidak boleh negatif." };
  if (end <= start) return { ok: false, error: "End harus lebih besar dari start." };
  const footage: SceneFootage = { kind: "segment", sourceUrl: scene.footage.sourceUrl, start, end };
  return { ok: true, manifest: setSceneFootage(manifest, sceneId, footage) };
}

// Durasi broll: set durationSeconds (> 0). videoUrl & motion/transisi dipertahankan.
export function setBrollDuration(manifest: SceneManifest, sceneId: string, durationSeconds: number): EditResult {
  const scene = manifest.scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: "Scene tidak ditemukan." };
  if (scene.footage.kind !== "broll") return { ok: false, error: "Scene ini bukan klip b-roll." };
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { ok: false, error: "Durasi harus lebih dari 0." };
  const footage: SceneFootage = { kind: "broll", videoUrl: scene.footage.videoUrl, durationSeconds };
  return { ok: true, manifest: setSceneFootage(manifest, sceneId, footage) };
}
