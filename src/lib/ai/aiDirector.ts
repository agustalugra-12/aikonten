import { getOpenAIClient } from "./openaiClient";
import { db } from "@/db";
import { musicBank } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ALL_MOTION_TYPES, type MotionType } from "@/lib/render/cameraMotion";
import { ALL_TRANSITION_TYPES, type TransitionType } from "@/lib/render/transitions";

// AI Director (2026-08-10, PRD "AI Content Editing Engine" - fitur INTI/pembeda utama,
// permintaan Agus eksplisit "AI Director dulu" saat ditanya prioritas). Sebelum modul
// ini, motion/transisi dipilih ROUND-ROBIN acak (fallback di ffmpeg.ts, lihat
// ALL_MOTION_TYPES/ALL_TRANSITION_TYPES) - tetap bergerak/ada transisi (bukan diam
// total), tapi TIDAK terkait isi cerita sama sekali. Director ini yg PRD maksud "AI
// tidak sekadar menggabungkan footage - AI menentukan kapan zoom/transisi/musik naik-
// turun BERDASARKAN narasi". Director bekerja di level SKRIP (bukan analisis visual tiap
// klip - itu tugas footage selection yg SUDAH jalan terpisah) - skrip dibagi rata
// proporsional ke jumlah klip yg SUDAH ditentukan (lihat processProject.ts), tiap
// segmen skrip diklasifikasi energinya (tenang/membangun/klimaks/dst), lalu energi itu
// dipetakan ke pilihan motion/transisi yg SESUAI showbiz convention (klimaks -> gerakan
// lebih hidup, tenang -> gerakan lambat) - bukan generate motion literal dari GPT
// (proporsional/murah: 1 panggilan GPT kecil per video, BUKAN 1 panggilan per klip).
export type MusicMood = "calm" | "mysterious" | "upbeat" | "dramatic" | "neutral" | "none";

export type DirectorDecision = {
  motions: MotionType[]; // 1 per klip
  transitions: TransitionType[]; // 1 per celah antar klip (N-1 utk N klip)
  musicMood: MusicMood; // "none" = sengaja tanpa musik (mis. narasi sangat padat/serius)
  // Sticker/Emoji Overlay (2026-08-10, PRD "Overlay: Sticker, Emoji") - index klip
  // PERTAMA berenergi "peak" (klimaks/fakta paling menarik), null kalau tidak ada beat
  // "peak" sama sekali. SENGAJA cuma 1 (bukan tiap klip peak) - sticker di SETIAP momen
  // seru akan jadi berlebihan/mengganggu, 1 flash yg tepat waktu lebih efektif drpd
  // banyak yg monoton (sama prinsip dgn CTA generik 1x drpd variasi tak perlu).
  stickerClipIndex: number | null;
};

const VALID_MOODS: MusicMood[] = ["calm", "mysterious", "upbeat", "dramatic", "neutral", "none"];

// Hook Optimization (2026-08-10, PRD "AI Content Editing Engine" - "3 detik pertama
// wajib memiliki curiosity/motion/subtitle/zoom, tidak boleh ada intro panjang") -
// klip PERTAMA dipaksa "zoom-in" TANPA PENGECUALIAN, tidak diserahkan ke klasifikasi
// GPT (bug nyata sblm fix ini: kalau GPT nilai beat pembuka sbg "calm" - narasi hook
// yg bernada tenang/eksplanatif - klip pertama bisa jadi "static", persis yg PRD
// larang). Subtitle sudah otomatis tampil dari frame pertama (dibakar sepanjang
// video, lihat ffmpeg.ts) - HANYA motion yg butuh override eksplisit di sini.
const HOOK_MOTION: MotionType = "zoom-in";

function fallbackDecision(clipCount: number): DirectorDecision {
  const motions = Array.from({ length: clipCount }, (_, i) => ALL_MOTION_TYPES[i % ALL_MOTION_TYPES.length]);
  if (motions.length > 0) motions[0] = HOOK_MOTION;
  return {
    motions,
    transitions: Array.from({ length: Math.max(0, clipCount - 1) }, (_, i) => ALL_TRANSITION_TYPES[i % ALL_TRANSITION_TYPES.length]),
    musicMood: "neutral",
    stickerClipIndex: null, // fallback round-robin tidak py info energi - tanpa sticker drpd nebak
  };
}

// Panggilan GPT TUNGGAL (gpt-4.1-mini - sama pertimbangan biaya dgn swap gpt-4.1 di
// youtubeEditorial.ts sebelumnya, tugas ini klasifikasi terstruktur bukan penulisan
// kreatif panjang, tidak butuh model lebih mahal) - kirim skrip PENUH + jumlah klip,
// minta pembagian energi per-segmen proporsional, TIDAK minta GPT hitung motion/
// transisi/timing FFmpeg literal (rawan halusinasi sintaks) - GPT cuma klasifikasi
// energi (calm/build/peak/resolve), pemetaan ke motion/transisi konkret dilakukan
// deterministik di kode (mapEnergyToMotion di bawah), bukan diserahkan ke GPT.
// Jumlah "scene" narasi yg diminta dari GPT - TETAP KECIL (max 8) apa pun jumlah klip
// (2026-08-10, bug nyata ditemukan saat verifikasi live - video Animal Story & Co bisa
// py 40-46+ klip [banyak broll pendek 5dtk], minta GPT klasifikasi energi SATU-SATU per
// klip sebanyak itu TIDAK RELIABLE, sering GPT balikin jumlah item yg tidak pas
// persis -> exact-length check gagal -> fallback round-robin, Director efektif TIDAK
// PERNAH kepakai utk video long-form yg justru paling butuh). Fix: GPT klasifikasi
// SEDIKIT "beat" narasi (max 8 - selaras PRD "Scene Engine": Hook/Explanation/Fact/
// Ending, bukan minta AI mikir per-klip), lalu proporsi ke jumlah klip SEBERAPAPUN
// scr matematis di kode (mapScenesToClips) - reliable utk video pendek MAUPUN panjang.
const MAX_SCENES = 8;

export async function planEdit(script: string, clipCount: number, brandId: string): Promise<DirectorDecision> {
  if (clipCount === 0) return fallbackDecision(0);
  const sceneCount = Math.max(3, Math.min(MAX_SCENES, clipCount));

  let sceneEnergies: string[];
  let musicMood: MusicMood;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `You are a video editing director. Given a narration script, divide its NARRATIVE ARC (not word ` +
            `count) into exactly ${sceneCount} sequential story beats in chronological order (e.g. hook, ` +
            "build-up, climax/most surprising fact, further explanation, conclusion/CTA - adapt to what the " +
            "script actually contains) and classify the EMOTIONAL ENERGY of each beat as one of: \"calm\" " +
            "(explanatory, slow-paced), \"build\" (growing curiosity/tension), \"peak\" (climax, most exciting/" +
            "surprising moment), \"resolve\" (wind-down, conclusion/CTA). Also classify the OVERALL mood of the " +
            "entire script as one of: calm, mysterious, upbeat, dramatic, neutral, or none (only \"none\" if " +
            "background music would genuinely be inappropriate/distracting). " +
            `Reply ONLY with JSON: {"segments": ["calm"|"build"|"peak"|"resolve", ...] (exactly ${sceneCount} ` +
            'items, chronological order), "overallMood": "calm"|"mysterious"|"upbeat"|"dramatic"|"neutral"|"none"}.',
        },
        { role: "user", content: script },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    sceneEnergies = Array.isArray(parsed.segments) && parsed.segments.length === sceneCount ? parsed.segments : [];
    musicMood = VALID_MOODS.includes(parsed.overallMood) ? parsed.overallMood : "neutral";
    if (sceneEnergies.length === 0) throw new Error("Director: jumlah scene tidak cocok, fallback");
  } catch (err) {
    console.error("[aiDirector] gagal dapat rencana edit dari GPT, fallback round-robin:", err);
    return fallbackDecision(clipCount);
  }

  // Proporsikan sceneEnergies (SEDIKIT) ke clipCount (BISA BANYAK) - klip ke-i ambil
  // energi dari scene yg "meliputi" posisi proporsionalnya di timeline. Deterministik,
  // tidak ada panggilan GPT tambahan apa pun jumlah klipnya.
  const energyLevels = Array.from({ length: clipCount }, (_, i) => {
    const sceneIdx = Math.min(sceneEnergies.length - 1, Math.floor((i / clipCount) * sceneEnergies.length));
    return sceneEnergies[sceneIdx];
  });

  const motions = energyLevels.map((energy, i) => mapEnergyToMotion(energy, i));
  if (motions.length > 0) motions[0] = HOOK_MOTION; // Hook Optimization - lihat catatan di atas fallbackDecision
  const transitions: TransitionType[] = [];
  for (let i = 0; i < energyLevels.length - 1; i++) {
    transitions.push(mapEnergyToTransition(energyLevels[i], energyLevels[i + 1], i));
  }

  const peakIdx = energyLevels.indexOf("peak");
  // Klip 0 dikecualikan (2026-08-10) - klip 0 SUDAH dapat motion "zoom-in" kuat dari Hook
  // Optimization di atas, sticker fire.png BARENGAN di klip pertama akan menumpuk 2 efek
  // sekaligus di detik pertama (berlebihan) - kalau klip "peak" pertama justru klip 0,
  // cari klip peak BERIKUTNYA saja.
  const stickerClipIndex = peakIdx > 0 ? peakIdx : energyLevels.indexOf("peak", 1);

  return { motions, transitions, musicMood, stickerClipIndex: stickerClipIndex >= 0 ? stickerClipIndex : null };
}

// Konvensi editing umum (bukan acak) - klimaks dapat gerakan lebih "hidup" (zoom-in
// mendekat/pan cepat terasa lebih intens), segmen tenang dapat gerakan lambat/statis,
// wind-down dapat zoom-out (kesan "menjauh"/menutup). i%2 dipakai HANYA utk variasi
// dalam 1 kelas energi yg sama (mis. 3 klip "calm" berturut-turut tidak semuanya
// persis static) - bukan sumber keputusan utama.
function mapEnergyToMotion(energy: string, i: number): MotionType {
  switch (energy) {
    case "peak":
      return i % 2 === 0 ? "zoom-in" : "pan-left";
    case "build":
      return i % 2 === 0 ? "pan-right" : "pan-left";
    case "resolve":
      return "zoom-out";
    case "calm":
    default:
      return i % 2 === 0 ? "static" : "zoom-in";
  }
}

// Transisi antar 2 segmen energi - lonjakan energi (mis. calm->peak) dapat transisi
// lebih tegas ("menghentak"), transisi antar energi SAMA/turun dapat yg lebih halus
// (tidak mengganggu penurunan tensi). "fadewhite"/"hblur"/"coverleft" (2026-08-10,
// PRD Flash/Blur/Push - lihat transitions.ts) dipakai sbg VARIASI kedua di tiap
// kelas (i%2, pola sama dgn mapEnergyToMotion di atas) - BUKAN pengganti pilihan lama
// yg sudah terverifikasi (zoomin utk lonjakan-ke-peak, slideleft utk lonjakan biasa,
// fade utk turun/sama), cuma menambah tekstur supaya video panjang dgn banyak transisi
// SEJENIS (mis. semua "build->peak") tidak terasa 100% identik berulang-ulang.
function mapEnergyToTransition(fromEnergy: string, toEnergy: string, i: number): TransitionType {
  const rank: Record<string, number> = { calm: 0, build: 1, peak: 2, resolve: 0 };
  const rising = (rank[toEnergy] ?? 0) > (rank[fromEnergy] ?? 0);
  if (rising) {
    if (toEnergy === "peak") return i % 2 === 0 ? "zoomin" : "fadewhite";
    return i % 2 === 0 ? "slideleft" : "hblur";
  }
  return i % 2 === 0 ? "fade" : "coverleft";
}

// Pilih 1 track dari Music Bank brand ini sesuai mood - RANDOM di antara kandidat mood
// yg cocok (bukan selalu track pertama, biar tidak monoton video ke video kalau Agus
// upload >1 track per mood). null kalau Music Bank brand ini KOSONG utk mood itu (atau
// mood="none") - processProject.ts WAJIB toleransi null (video tetap jalan TANPA musik,
// bukan re-throw error - musik latar itu peningkatan kualitas, bukan syarat wajib render).
export async function pickMusicTrack(brandId: string, mood: MusicMood): Promise<string | null> {
  if (mood === "none") return null;
  const candidates = await db.select().from(musicBank).where(eq(musicBank.brandId, brandId));
  const matching = candidates.filter((c) => c.mood === mood);
  const pool = matching.length > 0 ? matching : candidates; // mood spesifik kosong -> pakai apa saja drpd tanpa musik
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)].fileUrl;
}
