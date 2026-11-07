// Orchestrator render Opsi C (2026-11-02): dari input pipeline -> komposisi HyperFrames ->
// worker -> MP4 di R2. Return {videoUrl, durationSeconds} SAMA bentuk dgn renderFinalVideo
// (ffmpeg) supaya downstream processProject (quality check, media_assets) tak berubah.
import { createHash } from "node:crypto";
import { buildComposition, type HfClip, type HfWord } from "./hyperframesComposition";
import { resolveMotionPackConfig } from "./motionPack";
import { deteksiAlasLogo } from "./logoContrast";
import { renderComposition } from "./hyperframesClient";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { getAudioDurationSeconds } from "@/lib/ai/dubbing";

// Font id Brand Kit -> nama family HyperFrames (bundled). Default Poppins.
const HF_FONT: Record<string, string> = {
  poppins: "Poppins", archivoblack: "Archivo Black", bebasneue: "Oswald",
  anton: "Oswald", dmserifdisplay: "Playfair Display", pacifico: "Poppins",
};
const INTRO_SECONDS = 3;

export type HyperframesRenderOpts = {
  projectId: string;
  brandId: string;
  orientation?: "portrait" | "landscape" | "square";
  brandName?: string | null;
  logoUrl?: string | null;   // brands.logo_url - logo brand di tepi atas video (mengganti tulisan nama)
  brandKitRaw?: string | null;   // brand.brandKit (JSON mentah) - diparse di sini
  hookText?: string | null;
  brollClips?: Array<{ videoUrl: string; durationSeconds: number }>;
  segments?: Array<{ sourceUrl: string; start: number; end: number }>;
  voiceoverBuffer: Buffer;
  wordTimings?: HfWord[];
  cta?: string;
  statOverlays?: Array<{ label: string; value: string }>; // dari pipeline (stat/harga) - ambil pertama
  lowerThird?: { name: string; tagline: string } | null;   // dari extractLowerThird (documentary)
  aiLook?: string | null;  // Fase 4 AI Director: recommendedLook - dipakai kalau brand belum set brandKit.look
  pacing?: string | null;  // Fase 4 AI Director: fast|medium|calm
  musicUrl?: string | null; // Fase 6 musik latar (dari pickMusicTrack di processProject)
  emphasisPhrases?: string[]; // Fase A HyperFrames Pro - kinetic callouts (frasa kunci AI)
  onQueueEvent?: (step: string, action: string, result: string) => void; // Gerbang 2: log antre/render/retry/fallback (flag-gated)
  // feat/hero-order (2026-11-04): daftar klip terpadu lintas-sumber SUDAH terurut (hero di index 0),
  // mediaStart dijaga. Kalau ADA -> dipakai apa adanya (menang atas brollClips/segments). TAK ADA ->
  // jalur lama broll-dulu-segment (mode observe = IDENTIK produksi).
  orderedClips?: Array<{ videoUrl: string; durationSeconds: number; mediaStart: number }>;
};

export async function renderViaHyperframes(
  opts: HyperframesRenderOpts
): Promise<{ videoUrl: string; durationSeconds: number }> {
  // Footage: broll + segments (segment -> clip pakai durasi trim). Kosong = faceless
  // (generator pakai background brand beranimasi, tanpa footage).
  // Broll (foto brand-derive + stok) dulu, lalu segment video bank (urutan 45fd784). Urutan/hero klip
  // sudah ditentukan pemanggil (footagePlan/applyFootageGuard di processProject).
  const clips: HfClip[] = [];
  if (opts.orderedClips !== undefined) {
    // feat/hero-order: daftar terpadu hero-first MENANG. [] = nol klip aman -> clips kosong -> FACELESS
    // (background brand beranimasi). JANGAN balik ke broll/segment lama (itu klip yg sudah ditolak guard).
    for (const c of opts.orderedClips) clips.push({ videoUrl: c.videoUrl, durationSeconds: c.durationSeconds, mediaStart: Math.max(0, c.mediaStart) });
  } else {
    // undefined = observe / jalur lama: broll dulu lalu segment (IDENTIK produksi).
    for (const b of opts.brollClips || []) clips.push({ videoUrl: b.videoUrl, durationSeconds: b.durationSeconds });
    for (const s of opts.segments || []) clips.push({ videoUrl: s.sourceUrl, durationSeconds: Math.max(0.5, s.end - s.start), mediaStart: Math.max(0, s.start) });
  }

  // Audio TTS -> R2 URL (base64 dilarang HyperFrames; worker fetch via URL).
  const audioKey = buildAssetKey(opts.brandId, opts.projectId, "hf-voiceover.mp3");
  const audioUrl = await uploadBuffer(audioKey, opts.voiceoverBuffer, "audio/mpeg");
  const audioDurationSeconds = await getAudioDurationSeconds(opts.voiceoverBuffer);
  // Diukur sekali per URL logo (di-ingat dalam proses); gagal -> "none" = tampilan lama.
  const alasLogo = await deteksiAlasLogo(opts.logoUrl);

  let bk: Record<string, unknown> = {};
  try { bk = opts.brandKitRaw ? JSON.parse(opts.brandKitRaw) : {}; } catch { bk = {}; }
  const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);

  const html = buildComposition({
    orientation: opts.orientation || "portrait",
    brand: {
      primary: str(bk.primaryColor, "#14213D"),
      accent: str(bk.highlightColor, "#FFD84D"),
      ink: str(bk.subtitleColor, "#FFFFFF"),
      cta: str(bk.ctaColor, "#CC1F1F"),
      font: HF_FONT[str(bk.subtitleFont, "poppins")] || "Poppins",
      // Nama brand MENTAH (bukan .toUpperCase()) - komposisi yang merapikan kapitalisasi; kalau brand
      // punya logo, logo dipakai MENGGANTI tulisan nama. Berlaku semua brand.
      mark: opts.brandName || "",
      logoUrl: opts.logoUrl || "",
      // Alas kontras: logo gelap di atas footage gelap nyaris hilang (cacat nyata 2026-11-07).
      logoPlate: alasLogo,
    },
    hook: opts.hookText || "",
    introSeconds: INTRO_SECONDS,
    clips,
    audioUrl,
    musicUrl: opts.musicUrl ?? null, // Fase 6 musik latar
    audioDurationSeconds,
    words: opts.wordTimings || [],
    cta: opts.cta || "",
    // Fase 3 look: brandKit.look MENANG (pilihan brand eksplisit); kalau brand belum set,
    // pakai Fase 4 AI Director recommendedLook; terakhir default "clean".
    look: str(bk.look, "") || opts.aiLook || "clean",
    pacing: opts.pacing || "medium", // Fase 4 AI Director
    emphasisPhrases: opts.emphasisPhrases || [], // Fase A kinetic callouts
    stats: (opts.statOverlays || []).map((s) => ({ label: s.label, value: s.value })), // Fase 5 data blocks (semua, staggered)
    stat: opts.statOverlays && opts.statOverlays[0] ? { label: opts.statOverlays[0].label, value: opts.statOverlays[0].value } : null,
    lowerThird: opts.lowerThird ? { title: opts.lowerThird.name, subtitle: opts.lowerThird.tagline, atSeconds: 1.2, durationSeconds: 4 } : null,
    // Motion Pack 1 (2026-11-06): null (default-off) -> undefined -> buildComposition jalur lama (identik).
    motionPack: resolveMotionPackConfig((bk as { motionPack?: unknown }).motionPack) ?? undefined,
  });

  // Gerbang 2: queueOpts selalu diteruskan; renderComposition abaikan kalau flag HYPERFRAMES_QUEUE_ENABLED off
  // (jalur lama IDENTIK). contentHash dari HTML = idempotency key (retry/submit-ulang tak render ganda).
  const contentHash = createHash("sha256").update(html).digest("hex").slice(0, 16);
  const mp4 = await renderComposition(html, { id: opts.projectId, name: opts.projectId }, undefined, {
    tenantId: opts.brandId, projectId: opts.projectId, contentHash, log: opts.onQueueEvent,
  });
  const videoKey = buildAssetKey(opts.brandId, opts.projectId, "final.mp4");
  const videoUrl = await uploadBuffer(videoKey, mp4, "video/mp4");
  return { videoUrl, durationSeconds: Math.round(INTRO_SECONDS + audioDurationSeconds) };
}
