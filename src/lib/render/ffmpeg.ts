import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { ScoredSegment } from "@/lib/ai/clipSelect";
import type { WordTiming } from "@/lib/ai/transcribe";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { runFfmpeg } from "./ffmpegExec";
import { buildCircularLogoPng, LOGO_SIZE_RATIO, LOGO_MARGIN_RATIO } from "@/lib/ai/logoOverlay";
import { buildWordHighlightAss, buildStaticAss, DEFAULT_SUBTITLE_DESIGN } from "./subtitleDesign";
import { buildCameraMotionFilter, ALL_MOTION_TYPES, type MotionType } from "./cameraMotion";
import {
  computeClipSequencePlan,
  planTreeMerge,
  TRANSITION_DURATION_SECONDS,
  type ClipRef,
  type TransitionType,
} from "./transitions";
import { buildProgressBarFilter } from "./overlayEngine";
import { buildSubscribeButtonFilterStages, getBellAssetPath, SUBSCRIBE_BUTTON_SHOW_LAST_SECONDS } from "./subscribeButton";
import { getStickerAssetPath, buildStickerFilterStages } from "./stickerOverlay";
import { nearestBeat } from "@/lib/ai/beatDetect";
import { buildColorGradeFilter, type ColorGradeConfig } from "./colorGrade";
import { buildStatOverlayFilterStages } from "./statOverlay";
import { buildLowerThirdFilter, LOWER_THIRD_END_SECONDS, NARRATION_LEAD_IN_SECONDS } from "./lowerThird";
import { buildComparisonBarFilter } from "./comparisonBar";
import { getStatIconPath } from "./statIcons";
import { MAX_STATS, type StatIconCategory } from "@/lib/ai/statExtractor";
import { getLottieFramePattern, getLottieMeta, buildLottieOverlayFilterStages } from "./lottieOverlay";

const execFileAsync = promisify(execFile);

// Render video LOKAL via FFmpeg (2026-08-05, permintaan Agus - "migrasi agar prosesnya
// free", ganti dari Cloudinary yg makan kredit berbayar). VPS ini sudah punya FFmpeg
// terpasang lengkap (dicek langsung sblm implementasi: --enable-libass utk subtitle,
// libx264/aac utk encode) - jadi TIDAK ADA biaya per-video lagi, cuma pakai CPU server
// yg sudah dibayar sbg bagian hosting. Signature return (RenderResult) & parameter
// SENGAJA disamakan persis dgn cloudinary.ts renderFinalVideo() - processProject.ts
// cuma ganti import, tidak perlu ubah logic pemanggilnya.
export type RenderResult = {
  videoUrl: string;
  durationSeconds: number;
};

// Orientasi video (2026-08-05, permintaan Agus - "vidio landscape atau potrait ini utk
// kebutuhan YT") - portrait (9:16, default lama - IG/TikTok Reels) vs landscape (16:9 -
// YouTube). Dulu TARGET_WIDTH/HEIGHT konstanta tetap, sekarang fungsi dari orientasi
// yg dikirim per-project (dari brands.videoOrientation, lihat processProject.ts).
export type VideoOrientation = "portrait" | "landscape" | "square";

function getTargetDimensions(orientation: VideoOrientation): { width: number; height: number } {
  if (orientation === "landscape") return { width: 1920, height: 1080 };
  if (orientation === "square") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

// Loudness normalization (2026-08-10, PRD "AI Content Editing Engine" - "Normalize
// Volume") - SEBELUM ini, volume final murni hasil ducking (sidechaincompress
// menurunkan musik, TIDAK menormalkan level ABSOLUT narasi/track sendiri) - video dari
// brand/TTS-run beda bisa kedengaran beda kencang. loudnorm 1-pass ke target -16 LUFS
// (standar umum platform streaming/sosial, sedikit di bawah -14 broadcast spy masih
// ada headroom sblm YouTube/TikTok ikut normalisasi sendiri saat playback) - TP=-1.5dB
// true-peak cegah clipping, LRA=11 batas rentang dinamis wajar (bukan terlalu flat).
// 1-pass (bukan 2-pass measure-then-apply) - cukup akurat utk video pendek/sedang,
// hindari ffmpeg run ganda yg 2x biaya waktu render per video.
const LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11";

// Style subtitle - lihat subtitleDesign.ts (Subtitle Designer, 2026-08-10, permintaan
// Agus - engine ASS word-highlight+pop gaya TikTok/YT Shorts). PENTING (bug nyata
// ditemukan lewat tes visual langsung - bukan cuma baca dokumentasi, masih relevan):
// filter "subtitles=file.srt:force_style=..." TIDAK predictable - MarginV/Fontsize di
// situ dihitung relatif ke resolusi INTERNAL kecil yg diasumsikan libass utk SRT polos
// (bukan resolusi video asli), jadi angka wajar spt MarginV=760 malah mendorong teks
// JAUH keluar frame sama sekali (invisible, bukan error). Solusinya (tetap dipakai):
// bikin file .ass EKSPLISIT dgn PlayResX/PlayResY = resolusi video SUNGGUHAN.

// Batas waktu + cgroup terpisah per panggilan ffmpeg (2026-08-13, insiden nyata - render
// Animal Story & Co 46 klip macet TOTAL 4.5 jam, habiskan semua RAM+swap VPS 2 core/
// 3.8GB ini [dipakai bareng PMS+MongoDB+AI Chat Bot], bikin 504 di SEMUA layanan sampai
// proses macetnya dimatikan paksa manual). MemoryHigh/MemoryMax service-level yang sudah
// ada (systemd, ditambahkan setelah insiden OOM SEBELUMNYA) TERNYATA TIDAK CUKUP - itu
// budget bareng utk SELURUH proses Next.js (termasuk thread yang melayani request web),
// jadi 1 child ffmpeg yang thrashing swap tetap bisa menyeret turun kemampuan server
// jawab request sama sekali walau service-nya sendiri tidak sampai di-OOM-kill.
//
// 2 lapis independen (pola sama dipakai Fase 4 Claude Code Control, PMS - proven):
// 1) Timeout keras via `execFile`'s opsi `timeout` bawaan Node - render yang genuinely
//    macet/thrashing (BUKAN cuma lambat) dihentikan paksa, bukan dibiarkan jalan berjam2.
// 2) `systemd-run --scope` cgroup TERPISAH dari cgroup service utama - budget RAM/CPU
//    ffmpeg TIDAK numpang ke budget yang sama dgn thread web-serving Next.js, jadi 1
//    render berat/macet tidak bisa lagi menyeret turun kemampuan situs jawab request sama
//    sekali (paling parah cuma render ITU yang gagal, bukan seluruh VPS ikut down).
// 40 menit (2026-08-14, dinaikkan dari 20 - bug nyata ditemukan pas migrasi Animal
// Story & Co: overlay final long-form [logo+subtitle+lower third+musik+loudnorm, ~222dtk
// output, filter chain berat] cuma sanggup speed=0.174x realtime di preset veryfast,
// genuinely butuh ~21-22 menit utk kasus terberat - 20 menit SEBELUMNYA memotong render
// yg sedang jalan normal [bukan macet/thrashing], bukan cuma jaring pengaman kasus
// macet spt niat awal). Tetap ADA batas (bukan dihapus) - render yg BENERAN macet masih
// dihentikan, cuma kasih ruang lebih utk render berat yg legit lambat.
// Wrapper ke ffmpegExec: satu kebijakan resource + semaphore global utk SEMUA render
// (2026-08-31, Fase 1 post-OOM audit). Konstanta resource & logika systemd-run dipindah
// ke ffmpegExec supaya utility calls (transcribe, qualityChecker, frameExtract,
// imageToClip) bisa pakai kebijakan yang sama.
async function run(cmd: string, args: string[]): Promise<void> {
  if (cmd !== "ffmpeg") {
    throw new Error(`run() internal di ffmpeg.ts hanya mendukung ffmpeg, diberi: ${cmd}`);
  }
  await runFfmpeg(args, "render");
}

async function getDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe tidak menghasilkan durasi valid utk ${filePath}`);
  return d;
}

// Escape path utk dipakai di filter FFmpeg (concat list, dll) - libav filter syntax
// memperlakukan ":"/"'"/"\\" sbg karakter spesial, walau path tmp Linux jarang
// mengandungnya, tetap diescape supaya aman.
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function srtTimeToAss(srtTime: string): string {
  const [hms, ms] = srtTime.trim().split(",");
  const [h, m, s] = hms.split(":");
  const centiseconds = Math.round(parseInt(ms, 10) / 10);
  return `${parseInt(h, 10)}:${m}:${s}.${String(centiseconds).padStart(2, "0")}`;
}

// Geser timestamp format ASS ("H:MM:SS.cc") sebesar deltaSeconds (2026-08-11, dipakai
// utk NARRATION_LEAD_IN_SECONDS - lihat lowerThird.ts) - dipakai HANYA di jalur
// fallback (srtContent statis, jarang kepakai - wordTimings jalur normal digeser
// langsung sbg angka detik, jauh lebih simpel).
function shiftAssTime(assTime: string, deltaSeconds: number): string {
  const [hms, cs] = assTime.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  const total = h * 3600 + m * 60 + s + Number(cs) / 100 + deltaSeconds;
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = Math.floor(total % 60);
  const centiseconds = Math.round((total - Math.floor(total)) * 100);
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function parseSrt(srt: string): Array<{ start: string; end: string; text: string }> {
  const blocks = srt.trim().split(/\n\s*\n/);
  const entries: Array<{ start: string; end: string; text: string }> = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIdx].split("-->");
    const text = lines
      .slice(timeLineIdx + 1)
      .join("\\N")
      .replace(/[{}]/g, ""); // buang karakter yg bentrok dgn ASS override tags
    if (!text.trim()) continue;
    entries.push({ start: srtTimeToAss(startRaw), end: srtTimeToAss(endRaw), text });
  }
  return entries;
}


// Gabung klip via TREE (divide & conquer, 2026-08-14 - ganti skema sequential
// [mergeClipsIncrementally] yg O(N^2): akumulator makin panjang tiap langkah bikin
// render 44 klip >2 jam. Rencana LENGKAP [urutan operasi, keputusan transisi, offset]
// sudah dihitung MURNI tanpa ffmpeg di planTreeMerge (transitions.ts) - fungsi ini
// tinggal MENJALANKAN rencana itu apa adanya, tidak mengambil keputusan visual apa pun
// sendiri. Properti OOM-safety TETAP: tiap panggilan ffmpeg cuma 2 input, sama seperti
// skema sequential sebelumnya - cuma cara mengelompokkan operasinya yg berubah
// (pohon, bukan rantai lurus), total kerja re-encode turun dari O(N x durasi) jadi
// O(log N x durasi).
async function mergeClipsTree(
  clipPaths: string[],
  clipDurations: number[],
  transitions: TransitionType[],
  outputPath: string,
  workDir: string
): Promise<void> {
  const steps = planTreeMerge(clipDurations, transitions);
  const stepPaths: string[] = [];

  const resolvePath = (ref: ClipRef): string =>
    ref.kind === "leaf" ? clipPaths[ref.clipIndex] : stepPaths[ref.stepIndex];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isRoot = i === steps.length - 1;
    const stepOutput = isRoot ? outputPath : path.join(workDir, `merge_step_${i}.mp4`);

    const filter = step.isTransition
      ? `[0:v][1:v]xfade=transition=${step.transitionType}:duration=${TRANSITION_DURATION_SECONDS}:offset=${step.offsetSeconds.toFixed(3)}[vout]`
      : `[0:v][1:v]concat=n=2:v=1:a=0[vout]`;

    // "ultrafast" utk step ANTARA - file ini SEGERA di-decode ulang di step berikutnya
    // (induknya di pohon), kompresi efisien tidak relevan buat file yg langsung
    // dibuang. Step TERAKHIR (root, jadi `concatenated.mp4`) tetap "veryfast" - satu2nya
    // file dari fungsi ini yg kualitas/ukurannya benar2 dipakai lebih lanjut (overlay
    // final + diukur ulang durasinya).
    await run("ffmpeg", [
      "-y",
      "-i", resolvePath(step.left),
      "-i", resolvePath(step.right),
      "-filter_complex", filter,
      "-map", "[vout]",
      "-c:v", "libx264",
      "-preset", isRoot ? "veryfast" : "ultrafast",
      "-crf", "23",
      stepOutput,
    ]);

    stepPaths.push(stepOutput);
  }
}

export async function renderFinalVideo(opts: {
  projectId: string;
  brandId: string;
  segments: (ScoredSegment & { sourceUrl: string })[];
  srtContent: string;
  // Subtitle Designer (2026-08-10) - kalau ADA (jalur normal, transkripsi ulang audio
  // TTS berhasil), dipakai utk render caption gaya TikTok/YT Shorts "kata per kata"
  // (highlight kata yg sedang diucapkan + pop). srtContent TETAP wajib dikirim sbg
  // FALLBACK kalau ini kosong/undefined (mis. Whisper gagal, lihat processProject.ts) -
  // subtitle tetap muncul (statis, tanpa animasi kata-per-kata) drpd video tanpa caption.
  wordTimings?: WordTiming[];
  brollClips?: Array<{ videoUrl: string; durationSeconds: number }>;
  // Audio TTS SUDAH DIGENERATE sebelumnya (2026-08-06, permintaan Agus - "subtitle
  // presisi dgn dubbing") - caller (processProject.ts) generate TTS DULU, transkripsi
  // ulang (Whisper) utk subtitle presisi, BARU render di sini - jadi fungsi ini terima
  // Buffer audio yg SUDAH JADI, BUKAN teks mentah lagi (dulu generateVoiceover dipanggil
  // DI SINI, artinya subtitle di srtContent dibangun SEBELUM audio ini ada sama sekali -
  // akar masalah subtitle tidak presisi. Lihat processProject.ts utk alur baru lengkap.
  voiceoverAudioBuffer?: Buffer;
  // Logo brand OPSIONAL (2026-08-05, permintaan Agus) - ditempel lingkaran, ukuran
  // proporsional (lihat logoOverlay.ts), pojok kanan-atas, JANGAN dianggap wajib -
  // brand tanpa logoUrl dilewati begitu saja.
  logoUrl?: string | null;
  // Orientasi (2026-08-05, permintaan Agus) - default "portrait" (perilaku lama, tidak
  // berubah kalau caller tidak kirim apa-apa).
  orientation?: VideoOrientation;
  // Camera Motion / Ken Burns (2026-08-10, AI Director) - 1 motion per klip di
  // `allClips` (urutan: segments dulu, baru brollClips - SAMA urutan penggabungan di
  // bawah). Kalau TIDAK dikirim (caller lama/belum pakai Director) atau array lebih
  // pendek dari jumlah klip, sisanya dapat rotasi ALL_MOTION_TYPES round-robin -
  // fungsi ini TETAP menghasilkan video bergerak (bukan diam) walau tanpa keputusan
  // Director eksplisit, bukan cuma jalan kalau Director ada.
  motions?: MotionType[];
  // Transisi antar klip (2026-08-10, AI Director) - transitions[i] = transisi ANTARA
  // klip ke-i dan klip ke-(i+1) (jadi panjangnya N-1 utk N klip, BEDA dari `motions`
  // yg 1:1 per klip). Sama pola fallback dgn motions - kosong/kurang -> rotasi
  // ALL_TRANSITION_TYPES round-robin (lihat transitions.ts).
  transitions?: TransitionType[];
  // Musik latar OPSIONAL (2026-08-10, AI Director - Music Bank) - URL file musik dari
  // musicBank (lihat schema.ts). Di-loop otomatis kalau lebih pendek dari video, fade
  // in/out di awal/akhir, & DUCK otomatis (sidechaincompress - volume musik turun
  // sendiri saat ada narasi, naik lagi saat narasi jeda) - BUKAN cuma volume statis
  // rendah sepanjang video, biar narasi tetap jelas terdengar tanpa musik "menutupi".
  // Diabaikan kalau tidak ada voiceoverAudioBuffer (musik tanpa narasi belum didukung -
  // proporsional utk sekarang, semua konten app ini SELALU py narasi TTS).
  musicUrl?: string | null;
  // Music Beat Sync (2026-08-10, PRD Roadmap V3 - lihat beatDetect.ts) - timestamp beat
  // (detik) dari FILE MUSIK ASLI (belum di-trim), dihitung SEKALI di processProject.ts.
  // Dipakai di 2 tempat di sini: (1) trim musik mulai dari beat PERTAMA (bukan detik 0
  // mentah - hindari intro musik yg "flat" sebelum hantaman pertama pas video mulai),
  // (2) snap momen sticker ke beat terdekat stlh di-shift ke jam POST-TRIM (lihat
  // komentar di titik pemakaian). Array kosong/undefined = tidak ada beat terdeteksi,
  // SEMUA logic beat sync di bawah di-skip diam2 (video tetap render normal apa
  // adanya, sama persis perilaku sblm Beat Sync ada - additive, bukan syarat wajib).
  musicBeatTimestamps?: number[];
  // Batas keras durasi output (2026-08-10, permintaan Agus "jangan buat short diatas 1
  // menit") - lihat catatan lengkap di dekat outputDurationSeconds di bawah.
  maxDurationSeconds?: number;
  // Overlay Engine (2026-08-10, PRD "AI Content Editing Engine") - lihat
  // overlayEngine.ts. Keduanya OPSIONAL & independen - showProgressBar default false
  // (tidak ada perubahan visual kalau caller tidak minta), ctaText default tidak ada
  // teks CTA sama sekali kalau kosong/undefined.
  showProgressBar?: boolean;
  ctaText?: string;
  // Sticker/Emoji Overlay (2026-08-10, PRD "Overlay: Sticker, Emoji" - lihat
  // stickerOverlay.ts) - index klip (di `allClips`, urutan sama dgn `motions`) yg
  // dapat flash sticker 🔥 singkat di awalnya. null/undefined = tidak ada sticker sama
  // sekali (mis. tidak ada beat "peak" terdeteksi, AI Director fallback, dst).
  stickerClipIndex?: number | null;
  // Motion Intensity + Color Grade (2026-08-10, preset editing "AI EDITING PRESET v2" -
  // lihat cameraMotion.ts/colorGrade.ts/stylePreset.ts) - motionIntensity default 1.0
  // (perilaku lama) kalau caller tidak kirim. colorGrade null/undefined = tidak ada
  // grading (perilaku lama, footage apa adanya).
  motionIntensity?: number;
  colorGrade?: ColorGradeConfig | null;
  // Graphic Overlay - Stat Card (2026-08-10, lihat statOverlay.ts) - clipIndex SAMA
  // urutan dgn `motions` (allClips: segments dulu, baru brollClips). Di luar rentang
  // clipStartOffsets = di-skip diam2 (jaga2 clipCount berubah), sama pola dgn sticker.
  statOverlays?: { label: string; value: string; clipIndex: number; iconCategory: StatIconCategory }[];
  // Lower Third + Comparison Bar (2026-08-10, "Overlay System PRD" Category A - lihat
  // lowerThird.ts/comparisonBar.ts) - keduanya pure drawbox/drawtext, TIDAK butuh
  // input ffmpeg tambahan (beda dari stat card yg py ikon gambar).
  lowerThird?: { name: string; tagline: string } | null;
  comparisonBar?: { label: string; value: string; kg: number; clipIndex: number } | null;
}): Promise<RenderResult> {
  if (opts.segments.length === 0) {
    throw new Error("Tidak ada klip footage asli terpilih utk dirender");
  }

  const { width: TARGET_WIDTH, height: TARGET_HEIGHT } = getTargetDimensions(opts.orientation || "portrait");
  const workDir = await mkdtemp(path.join(tmpdir(), `kontenpilot_render_${opts.projectId}_`));

  try {
    // 1) Trim + normalisasi (scale+crop ke ukuran seragam, drop audio) TIAP klip -
    // footage asli & broll Pexels hampir pasti beda resolusi/fps, WAJIB diseragamkan
    // dulu sblm concat (sama alasannya dgn Cloudinary versi lama: "Concatenated videos
    // sizes don't match" kalau tidak diseragamkan).
    const allClips: Array<{ url: string; start: number; end: number }> = [
      ...opts.segments.map((s) => ({ url: s.sourceUrl, start: s.start, end: s.end })),
      ...(opts.brollClips || []).map((c) => ({ url: c.videoUrl, start: 0, end: c.durationSeconds })),
    ];

    const normalizedPaths: string[] = [];
    const normalizedDurations: number[] = [];
    for (const [i, clip] of allClips.entries()) {
      const duration = Math.max(0.2, clip.end - clip.start);
      const outPath = path.join(workDir, `clip_${i}.mp4`);
      // Motion dari Director kalau ada, else rotasi round-robin (lihat catatan `motions`
      // di atas) - klip PENDEK (<1.5dtk) dipaksa "static" krn zoom/pan kerasa "loncat"/
      // gerak-terlalu-cepat kalau durasinya terlalu singkat utk gerakan halus.
      const motion: MotionType =
        duration < 1.5 ? "static" : opts.motions?.[i] || ALL_MOTION_TYPES[i % ALL_MOTION_TYPES.length];
      // Retry (2026-08-27, bug nyata Animal Story & Co - 3 render gagal semalam dgn
      // "ffprobe tidak menghasilkan durasi valid") - `clip.url` di-fetch LANGSUNG oleh
      // ffmpeg (bukan file lokal), kegagalan transien (network blip/CDN sumber sesaat
      // tidak responsif) bisa membuat ffmpeg "sukses" (exit 0) tapi outPath rusak/tanpa
      // durasi valid - baru ketahuan di getDurationSeconds. Retry PENUH (ffmpeg + cek
      // durasi ulang, bukan cuma cek durasi) krn kegagalannya di fetch/encode, bukan di
      // pembacaan file. Pola sama dgn falRetry.ts (MAX_ATTEMPTS retry singkat, jeda
      // pendek antar percobaan) utk kelas kegagalan yang sama: transien, bukan bug kode.
      const MAX_CLIP_ATTEMPTS = 3;
      let clipDuration: number | undefined;
      for (let attempt = 1; ; attempt++) {
        try {
          await run("ffmpeg", [
            "-y",
            "-ss", String(clip.start),
            "-i", clip.url,
            "-t", String(duration),
            "-vf", buildCameraMotionFilter(motion, TARGET_WIDTH, TARGET_HEIGHT, duration, opts.motionIntensity ?? 1.0),
            "-an",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            outPath,
          ]);
          clipDuration = await getDurationSeconds(outPath);
          break;
        } catch (err) {
          if (attempt >= MAX_CLIP_ATTEMPTS) throw err;
          console.warn(
            `[ffmpeg] Normalisasi klip ${i} (${clip.url}) gagal percobaan ${attempt}/${MAX_CLIP_ATTEMPTS}, retry: ${(err as Error).message}`,
          );
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      normalizedPaths.push(outPath);
      // Durasi AKTUAL hasil encode (bukan asumsi `duration` yg diminta) - frame
      // rounding di fps=30 bisa geser sepersekian detik, xfade offset WAJIB akurat
      // (lihat transitions.ts) drpd ikut menyimpang sedikit demi sedikit tiap klip.
      normalizedDurations.push(clipDuration);
    }

    // 2) Sambung klip PAKAI TRANSISI (xfade, 2026-08-10 - lihat transitions.ts kenapa
    // BUKAN lagi concat demuxer polos "-c copy". WAJIB re-encode di sini (xfade tidak
    // bisa stream-copy), lebih lambat drpd demuxer tapi hasilnya ada transisi
    // sungguhan, bukan cuma hard-cut).
    const { totalDurationSeconds: estimatedDuration, clipStartOffsets } = computeClipSequencePlan(
      normalizedDurations,
      opts.transitions || []
    );
    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    if (normalizedPaths.length === 1) {
      await run("ffmpeg", ["-y", "-i", normalizedPaths[0], "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", concatenatedPath]);
    } else {
      await mergeClipsTree(normalizedPaths, normalizedDurations, opts.transitions || [], concatenatedPath, workDir);
    }
    void estimatedDuration; // dihitung ulang dari file ASLI di bawah (lebih akurat drpd estimasi filter chain)
    const videoDurationSeconds = await getDurationSeconds(concatenatedPath);

    // 3) Subtitle -> .ass eksplisit (Subtitle Designer, lihat subtitleDesign.ts - WAJIB
    // .ass eksplisit, bukan subtitles=+force_style yg terbukti nyata tidak predictable
    // posisi/ukurannya). wordTimings ADA -> caption "kata per kata" gaya TikTok/YT
    // Shorts, kosong -> fallback statis dari srtContent (tetap ikut Subtitle Designer
    // utk font/warna/posisi, cuma tanpa animasi per-kata).
    // Narration Lead-In (2026-08-11, permintaan Agus - lihat NARRATION_LEAD_IN_SECONDS
    // di lowerThird.ts) - HANYA aktif kalau video ini py lower third (preset
    // documentary), brand lain TIDAK terpengaruh sama sekali. Subtitle (& audio
    // narasinya, lihat adelay di bawah) digeser mundur supaya lower third dapat momen
    // sendirian dulu sebelum penjelasan+animasi lain masuk.
    const leadInSeconds = opts.lowerThird ? NARRATION_LEAD_IN_SECONDS : 0;
    const assPath = path.join(workDir, "subtitles.ass");
    const assContent =
      opts.wordTimings && opts.wordTimings.length > 0
        ? buildWordHighlightAss(
            leadInSeconds > 0
              ? opts.wordTimings.map((w) => ({ ...w, start: w.start + leadInSeconds, end: w.end + leadInSeconds }))
              : opts.wordTimings,
            DEFAULT_SUBTITLE_DESIGN,
            TARGET_WIDTH,
            TARGET_HEIGHT
          )
        : buildStaticAss(
            leadInSeconds > 0
              ? parseSrt(opts.srtContent).map((e) => ({
                  ...e,
                  start: shiftAssTime(e.start, leadInSeconds),
                  end: shiftAssTime(e.end, leadInSeconds),
                }))
              : parseSrt(opts.srtContent),
            DEFAULT_SUBTITLE_DESIGN,
            TARGET_WIDTH,
            TARGET_HEIGHT
          );
    await writeFile(assPath, assContent);

    // 4) Logo brand OPSIONAL (2026-08-05, permintaan Agus) - crop lingkaran +
    // ukuran proporsional (logoOverlay.ts, dipakai jg utk foto - konsisten), disiapkan
    // sbg file PNG lokal dulu (ffmpeg overlay filter butuh input file, bukan URL).
    let logoPath: string | null = null;
    if (opts.logoUrl) {
      const logoSize = Math.round(TARGET_WIDTH * LOGO_SIZE_RATIO);
      const logoPngBuffer = await buildCircularLogoPng(opts.logoUrl, logoSize);
      logoPath = path.join(workDir, "logo.png");
      await writeFile(logoPath, logoPngBuffer);
    }

    // 5) AI Dubbing - GANTI TOTAL audio asli dgn TTS baca caption (lihat memory
    // proyek, keputusan eksplisit Agus). Audio-nya SUDAH DIGENERATE oleh caller
    // (lihat catatan voiceoverAudioBuffer di atas) - di sini cuma tulis ke file lokal.
    // Nama file ".mp3" (2026-08-10, dubbing.ts balik ke OpenAI TTS/gpt-4o-mini-tts yg
    // balikin MP3, sempat ".wav" singkat pas pakai Kokoro) - ffmpeg sendiri probe isi
    // FILE bukan ekstensi utk input (`-i`), jadi ekstensi salah TIDAK PERNAH benar2
    // gagal decode, ini murni supaya nama file jujur soal isinya, bukan perbaikan bug
    // fungsional.
    let audioPath: string | null = null;
    let audioDurationSeconds = 0;
    if (opts.voiceoverAudioBuffer) {
      audioPath = path.join(workDir, "voiceover.mp3");
      await writeFile(audioPath, opts.voiceoverAudioBuffer);
      // +leadInSeconds (2026-08-11) - durasi FILE aslinya tidak berubah, tapi di
      // filter_complex nanti narasi ditunda `leadInSeconds` (adelay) sebelum mulai
      // bicara - total durasi EFEKTIF di linimasa akhir jadi lebih panjang segitu.
      // Kalau ini tidak dihitung, video/output bisa kepotong PAS sebelum narasi
      // selesai (sama kelas bug dgn catatan "narasi sampai tengah sudah habis" di
      // bawah - needsVideoLoop/outputDurationSeconds WAJIB tahu durasi efektif ini).
      audioDurationSeconds = (await getDurationSeconds(audioPath)) + leadInSeconds;
    }
    // Narasi lebih panjang dari footage yg berhasil terkumpul (2026-08-10, laporan
    // Agus - "narasi sampai tengah sudah habis... long atau short vidio harus begitu"
    // [narasi SEHARUSNYA sampai akhir, bukan berhenti di tengah]) - PALING SERING
    // kejadian di channel TANPA Bank Footage sendiri (YouTube Editorial Engine, full
    // B-roll stok) - Pexels/Pixabay bisa kehabisan klip BARU yg cocok utk query
    // tertentu jauh SEBELUM footage mencapai target durasi brand, sementara skripnya
    // sendiri ditulis utk durasi PENUH (lihat youtubeEditorial.ts). SEBELUM ini output
    // SELALU dipotong ke videoDurationSeconds (`-t`, lihat komentar di bawah soal audio
    // PENDEK) - kalau audio (narasi) JUSTRU LEBIH PANJANG dari video, narasi ikut
    // terpotong di tengah kalimat, bukan cuma videonya. Deteksi di sini: kalau audio
    // > video, video di-LOOP (`-stream_loop -1` pada input concatenatedPath, ffmpeg
    // ulang dari awal secukupnya) supaya SELALU cukup panjang menutupi audio penuh -
    // subtitle (word-timing asli dari audio) tetap akurat krn timing-nya sendiri
    // memang berbasis audio, bukan video. Kasus SEBALIKNYA (audio lebih pendek -
    // caption Pelangi singkat) TIDAK BERUBAH SAMA SEKALI (loop cuma aktif kalau
    // audio>video, apad di bawah tetap jalan spt sebelumnya).
    const needsVideoLoop = audioDurationSeconds > videoDurationSeconds;
    // maxDurationSeconds (2026-08-10, permintaan Agus - "jangan buat short diatas 1
    // menit ini aturannya") - PENGAMAN KERAS, beda dari durationConfig.target (60,
    // lihat processProject.ts) yg cuma target LUNAK saat pemilihan klip/estimasi audio
    // - target lunak BISA overshoot (mis. narasi TTS sedikit lebih panjang dari estimasi
    // kata/detik, atau footage nge-loop lebih dari perkiraan) tanpa APAPUN yg secara
    // eksplisit MEMOTONG hasil akhirnya. Cap ini di titik PALING AKHIR (`-t` render),
    // jadi output MP4 Shorts TIDAK PERNAH melebihi batas ini apa pun yg terjadi di
    // langkah-langkah sebelumnya - jaring pengaman terakhir, bukan gantikan target lunak.
    const outputDurationSeconds = opts.maxDurationSeconds
      ? Math.min(Math.max(videoDurationSeconds, audioDurationSeconds), opts.maxDurationSeconds)
      : Math.max(videoDurationSeconds, audioDurationSeconds);

    // 6) Bakar subtitle + overlay logo + mux audio TTS. PENTING (bug nyata ditemukan
    // lewat tes - "-vf" simple-filter DIGABUNG dgn "-map" eksplisit bikin filter
    // subtitle SENYAP tidak pernah kepakai, walau tidak ada error sama sekali): WAJIB
    // pakai -filter_complex dgn label output eksplisit ([vout]) baru di-map, bukan -vf
    // biasa. Urutan input: 0=video gabungan, lalu logo (kalau ada), lalu audio (kalau
    // ada) - index dilacak manual krn keduanya opsional & urutannya penting.
    const finalPath = path.join(workDir, "final.mp4");
    const finalArgs = ["-y"];
    if (needsVideoLoop) {
      // "-stream_loop -1" ulang input INI (concatenatedPath) dari awal terus-menerus -
      // output tetap di-cap eksplisit ke outputDurationSeconds di bawah, jadi TIDAK
      // pernah render tanpa batas, cuma memastikan videonya CUKUP panjang menutupi
      // audio yg lebih panjang.
      finalArgs.push("-stream_loop", "-1");
    }
    finalArgs.push("-i", concatenatedPath);
    let nextInputIdx = 1;
    let logoInputIdx: number | null = null;
    if (logoPath) {
      // "-loop 1" WAJIB (bug nyata ditemukan lewat tes render sungguhan, bukan cuma
      // baca kode - lihat catatan fade di bawah): tanpa ini, gambar statis cuma jadi
      // stream SATU frame di t=0 (durasi ~1/25dtk default). Filter fade=t=in:st=0:d=0.5
      // ngevaluasi alpha frame SATU2NYA itu tepat di t=0 -> alpha=0 (transparan penuh),
      // lalu overlay MEMBEKUKAN frame transparan itu utk sisa durasi video - logo
      // hilang total, bukan cuma soal timing. "-loop 1" bikin gambar jadi stream
      // frame berulang tanpa henti spy fade bisa benar2 beranimasi lewat waktu; output
      // akhir tetap dibatasi "-t" di bawah spt pola loop musik/video lain di file ini.
      finalArgs.push("-loop", "1", "-i", logoPath);
      logoInputIdx = nextInputIdx++;
    }
    // Sticker (2026-08-10, lihat stickerOverlay.ts) - HANYA di-input kalau AI Director
    // pilih 1 klip "peak" DAN index-nya valid (dalam rentang clipStartOffsets - jaga2
    // kalau clipCount berubah/mismatch). Sama "-loop 1" WAJIB spt logo di atas.
    // Reaction VARIAN (2026-08-11, permintaan Agus "animasi sebanyak mungkin") - momen
    // "peak" yg sama sekarang py 2 kemungkinan visual: sticker api statis (asli) ATAU
    // badge "WOW!" Lottie yg BERANIMASI (pop-in bintang+tetesan, lihat lottieOverlay.ts/
    // assets/lottie/wow) - dipilih ACAK 50/50 tiap render, supaya video tidak monoton
    // (tema besar sesi ini - "konten tidak boleh monoton") TANPA nambah elemen baru yg
    // bikin layar penuh (masih SATU reaction per video, di slot & trigger yg SAMA
    // persis, cuma variasi visualnya).
    let stickerInputIdx: number | null = null;
    let wowInputIdx: number | null = null;
    const stickerStartSeconds =
      opts.stickerClipIndex != null && opts.stickerClipIndex >= 0 && opts.stickerClipIndex < clipStartOffsets.length
        ? clipStartOffsets[opts.stickerClipIndex]
        : null;
    const useWowReaction = Math.random() < 0.5;
    if (stickerStartSeconds !== null && useWowReaction) {
      finalArgs.push("-framerate", String(getLottieMeta("wow").fps), "-i", getLottieFramePattern("wow"));
      wowInputIdx = nextInputIdx++;
    } else if (stickerStartSeconds !== null) {
      finalArgs.push("-loop", "1", "-i", getStickerAssetPath());
      stickerInputIdx = nextInputIdx++;
    }
    // Ikon Stat Card (2026-08-10, "Overlay System PRD" Category A - lihat
    // statIcons.ts) - 1 input PNG per stat yg VALID (clipIndex dalam rentang), sama
    // "-loop 1" WAJIB spt logo/sticker di atas. Disimpan berpasangan dgn statOverlays
    // aslinya (bukan array index terpisah) spy urutan tidak pernah salah pasang.
    //
    // Cap keras (2026-08-14, temuan #4 Lampiran D ENGINEERING_SAFETY.md / audit
    // kontenpilot §4/§6) - fan-in ke ffmpeg call TERBESAR di codebase ini (Step 6 final
    // overlay, sudah py video+logo+sticker/wow+bell+confetti+voiceover+musik sbg input
    // lain) TIDAK BOLEH tumbuh tanpa batas dari 1 variabel yg tidak terkait clip count
    // (jumlah stat overlay hasil ekstraksi GPT) - bentuk risiko SAMA dgn bug tree-merge
    // OOM malam ini (1 proses ffmpeg pegang N input simultan), variabel beda. statExtractor.ts
    // SUDAH cap MAX_STATS=3 di sumbernya ("Never clutter the screen") - baris `.slice`
    // di bawah ini backstop DEFENSE-IN-DEPTH di titik fan-in-nya sendiri (bukan cuma
    // percaya upstream selalu benar) - truncate (ambil N pertama, urutan SUDAH by
    // positionFraction/kemunculan di narasi dari statExtractor) drpd gagalkan seluruh
    // render kalau suatu saat ada >MAX_STATS item masuk sini.
    const validStatOverlays = (opts.statOverlays || [])
      .filter((s) => s.clipIndex >= 0 && s.clipIndex < clipStartOffsets.length)
      .slice(0, MAX_STATS);
    const statIconInputIdx: number[] = [];
    for (const stat of validStatOverlays) {
      finalArgs.push("-loop", "1", "-i", getStatIconPath(stat.iconCategory));
      statIconInputIdx.push(nextInputIdx++);
    }
    // (2026-09-01, audit reliability - render timeout 120 menit kasus nyata "Clark's
    // Nutcracker" di VPS 2-core: proses ffmpeg jalan 2 jam, di-SIGKILL paksa) Bell &
    // confetti SAMA-SAMA cuma tampil di `SUBSCRIBE_BUTTON_SHOW_LAST_SECONDS` (4 detik)
    // TERAKHIR video, tapi input-nya (`-loop 1`/`-framerate` biasa) mulai dari t=0 -
    // tanpa perlakuan khusus, filter eval=frame (bell pulse) & tpad-clone (confetti,
    // lihat lottieOverlay.ts) akan memproses SELURUH durasi video (bisa >7 menit utk
    // long-form) padahal cuma perlu ~4 detik terakhir. `-itsoffset` di level INPUT
    // ffmpeg (bukan filter) menunda kemunculan stream ini TANPA decode/generate frame
    // apa pun sebelum offset-nya - jauh lebih murah drpd tpad clone yang harus
    // memproses tiap frame padding lewat filter chain (format/scale/colorchannelmixer).
    const subscribeAccentStart = opts.ctaText
      ? Math.max(0, outputDurationSeconds - SUBSCRIBE_BUTTON_SHOW_LAST_SECONDS)
      : 0;
    // Bell icon utk Subscribe Button animasi (2026-08-11 - lihat subscribeButton.ts) -
    // HANYA di-input kalau ctaText ADA (sama pola dgn logo/sticker - opsional, bukan
    // wajib tiap render).
    let bellInputIdx: number | null = null;
    if (opts.ctaText) {
      finalArgs.push("-itsoffset", subscribeAccentStart.toFixed(2), "-loop", "1", "-i", getBellAssetPath());
      bellInputIdx = nextInputIdx++;
    }
    // (2026-09-01, permintaan Agus - "jangan gunakan confetti") Confetti outro
    // DIHAPUS dari pipeline - input & filter stage-nya (dulu di sini) tidak lagi
    // dibuat. BUKAN krn berat (setelah fix -itsoffset di atas, biayanya sudah kecil,
    // cuma ~4 detik data) - murni keputusan visual/kesederhanaan. Asset PNG sequence-
    // nya (assets/lottie/confetti/) dibiarkan di disk, tidak dihapus, kalau suatu saat
    // mau dipakai lagi tinggal kembalikan blok ini (lihat git history commit 27234ff/
    // 13b2ee3 utk kode aslinya).
    let audioInputIdx: number | null = null;
    if (audioPath) {
      finalArgs.push("-i", audioPath);
      audioInputIdx = nextInputIdx++;
    }
    // Musik latar (2026-08-10, AI Director/Music Bank) - "-stream_loop -1" SELALU
    // dipasang kalau ada musik (sama teknik dgn needsVideoLoop di atas) drpd ffprobe
    // durasi track dulu utk tahu perlu loop atau tidak - lebih simpel & SELALU aman
    // (musik pendek KE panjang otomatis ke-cover, musik yg KEBETULAN sudah lebih
    // panjang dari video cuma looping tidak pernah kepakai krn output di-cap `-t` di
    // akhir apa pun keadaannya).
    let musicInputIdx: number | null = null;
    // Music Beat Sync (2026-08-10) - trim musik mulai dari beat PERTAMA (bukan detik 0
    // mentah) via "-ss" SEBELUM "-i", spy hantaman pertama musik jatuh TEPAT di awal
    // video (selaras Hook Optimization - klip 0 SUDAH zoom-in kuat, sekarang musiknya
    // juga "berbunyi" di detik yg sama, bukan di tengah intro musik yg flat). Clamp
    // maks 8dtk (2026-08-10) - kalau beat pertama terdeteksi jauh di dlm file (mis.
    // intro musik panjang), JANGAN buang terlalu banyak bagian track, drpd trim
    // agresif yg berpotensi kehabisan materi musik lebih cepat saat di-loop.
    const rawFirstBeat = opts.musicBeatTimestamps && opts.musicBeatTimestamps.length > 0 ? opts.musicBeatTimestamps[0] : 0;
    const musicTrimSeconds = Math.min(8, Math.max(0, rawFirstBeat));
    if (opts.musicUrl && audioInputIdx !== null) {
      const musicArgs = musicTrimSeconds > 0 ? ["-ss", musicTrimSeconds.toFixed(2)] : [];
      finalArgs.push("-stream_loop", "-1", ...musicArgs, "-i", opts.musicUrl);
      musicInputIdx = nextInputIdx++;
    }
    // Beat POST-TRIM (2026-08-10) - stlh musik dipotong mulai dari musicTrimSeconds,
    // jam musik yg didengar penonton bergeser: beat yg tadinya di t=X (file asli)
    // sekarang terdengar di t=(X-musicTrimSeconds). Cuma ambil beat SETELAH titik trim
    // (beat sebelum itu sudah "terpotong", tidak relevan) - dipakai snap sticker di
    // bawah, BUKAN timestamp asli lagi.
    const postTrimBeats = (opts.musicBeatTimestamps || [])
      .filter((t) => t >= musicTrimSeconds)
      .map((t) => t - musicTrimSeconds);
    // Snap sticker ke beat terdekat (2026-08-10, Music Beat Sync) - toleransi 0.4dtk
    // (sama nilai default yg masuk akal dipakai nearestBeat lain). Tidak ketemu beat
    // dekat (atau tidak ada musik sama sekali, postTrimBeats kosong) -> fallback ke
    // stickerStartSeconds APA ADANYA (posisi awal klip "peak", perilaku SEBELUM Beat
    // Sync ada - tetap benar, cuma tidak "on-beat").
    const snappedStickerStartSeconds =
      stickerStartSeconds !== null ? nearestBeat(postTrimBeats, stickerStartSeconds, 0.4) ?? stickerStartSeconds : null;

    const logoMargin = Math.round(TARGET_WIDTH * LOGO_MARGIN_RATIO);
    const filterStages: string[] = [];
    let curLabel = "0:v";
    // Color Grading (2026-08-10, preset editing - lihat colorGrade.ts) - DILAKUKAN
    // PALING AWAL, SEBELUM subtitle dibakar - grading cuma mengubah warna/kontras
    // FOOTAGE, teks subtitle (putih/kuning solid) TIDAK PERLU ikut ke-grading (bisa
    // bikin warnanya melenceng dari desain Subtitle Designer yg sudah presisi).
    if (opts.colorGrade) {
      filterStages.push(`[${curLabel}]${buildColorGradeFilter(opts.colorGrade)}[graded]`);
      curLabel = "graded";
    }
    // Chain label dinamis (2026-08-10, DIPERLUAS - logo dulu satu2nya tahap opsional
    // setelah subtitle, sekarang bisa +progress bar +CTA jg) - tahap TERAKHIR yg
    // benar2 jalan SELALU keluarkan label "vout" (dihitung di akhir, bukan diasumsikan
    // di tengah), tahap SEBELUM itu pakai label sementara unik.
    filterStages.push(`[${curLabel}]ass=${escapeFilterPath(assPath)}[subbed]`);
    curLabel = "subbed";
    if (logoInputIdx !== null) {
      // Fade-in 0.5dtk (2026-08-10, Motion Engine - PRD "AI Content Editing Engine"
      // section 19/20) - logo sebelumnya muncul INSTAN dari frame pertama, elemen
      // overlay lain (subtitle pop-in, CTA fade-in) sudah py animasi masuk, ini yg
      // terakhir masih polos. `fade` filter FFmpeg native support alpha fade langsung
      // (bukan cuma warna) - diterapkan ke STREAM logo SEBELUM di-composite, simpel
      // drpd ekspresi alpha manual spt di CTA (logo statis, tidak butuh kompleksitas
      // scale/posisi berubah - cukup opacity naik).
      filterStages.push(`[${logoInputIdx}:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1[logofmt]`);
      filterStages.push(`[${curLabel}][logofmt]overlay=W-w-${logoMargin}:${logoMargin}[logoed]`);
      curLabel = "logoed";
    }
    if (stickerInputIdx !== null && snappedStickerStartSeconds !== null) {
      filterStages.push(...buildStickerFilterStages(stickerInputIdx, snappedStickerStartSeconds, TARGET_WIDTH, curLabel, "stickered"));
      curLabel = "stickered";
    } else if (wowInputIdx !== null && snappedStickerStartSeconds !== null) {
      // Posisi & ukuran SAMA persis dgn slot sticker api (pojok kiri-atas, margin sama) -
      // badge WOW dirender sedikit lebih besar (lebih banyak elemen visual/teks drpd 1
      // emoji api, perlu ruang lebih spy tetap terbaca) tapi tetap 1 slot, tidak nambah
      // area baru.
      const margin = Math.round(TARGET_WIDTH * 0.04);
      const wowMeta = getLottieMeta("wow");
      const wowWidth = Math.round(TARGET_WIDTH * 0.24);
      filterStages.push(
        ...buildLottieOverlayFilterStages(
          wowInputIdx,
          wowMeta,
          wowWidth,
          snappedStickerStartSeconds,
          margin,
          margin,
          curLabel,
          "stickered",
          { fadeOutSeconds: 0.3 }
        )
      );
      curLabel = "stickered";
    }
    // Graphic Overlay - Stat Card (2026-08-10, DGN IKON - lihat statOverlay.ts) - tiap
    // stat dapat beberapa STAGE berurutan (box+ikon+teks, per statIconInputIdx yg
    // SUDAH di-input di atas, urutan array SAMA persis dgn validStatOverlays). Timing
    // pakai clipStartOffsets MENTAH (posisi awal klip, TIDAK di-snap ke beat spt
    // sticker - stat card soal KAPAN faktanya disebut di narasi, bukan irama musik).
    validStatOverlays.forEach((stat, idx) => {
      // Tunda stat card kalau jatuh di jendela lower third (2026-08-11, bug nyata
      // ditemukan lewat render "Pink Fairy Armadillo" - stat card & lower third
      // numpuk PERSIS di 0.6-3.2dtk, dicek langsung lewat frame, bukan asumsi).
      // Cuma stat yg BENERAN jatuh di jendela itu yg ditunda - stat lain di klip
      // lebih belakang tidak disentuh sama sekali.
      const rawStart = clipStartOffsets[stat.clipIndex];
      const startSeconds = opts.lowerThird && rawStart < LOWER_THIRD_END_SECONDS ? LOWER_THIRD_END_SECONDS + 0.1 : rawStart;
      const outLabel = `statted${idx}`;
      filterStages.push(
        ...buildStatOverlayFilterStages(
          statIconInputIdx[idx],
          stat.label,
          stat.value,
          startSeconds,
          TARGET_WIDTH,
          TARGET_HEIGHT,
          curLabel,
          outLabel
        )
      );
      curLabel = outLabel;
    });
    if (opts.lowerThird) {
      filterStages.push(`[${curLabel}]${buildLowerThirdFilter(opts.lowerThird.name, opts.lowerThird.tagline, TARGET_WIDTH, TARGET_HEIGHT)}[lowerthirded]`);
      curLabel = "lowerthirded";
    }
    if (opts.comparisonBar && opts.comparisonBar.clipIndex >= 0 && opts.comparisonBar.clipIndex < clipStartOffsets.length) {
      const cb = opts.comparisonBar;
      const startSeconds = clipStartOffsets[cb.clipIndex];
      filterStages.push(`[${curLabel}]${buildComparisonBarFilter(cb.label, cb.value, cb.kg, startSeconds, TARGET_WIDTH, TARGET_HEIGHT)}[compared]`);
      curLabel = "compared";
    }
    if (opts.showProgressBar) {
      filterStages.push(`[${curLabel}]${buildProgressBarFilter(TARGET_WIDTH, TARGET_HEIGHT, outputDurationSeconds)}[barred]`);
      curLabel = "barred";
    }
    // (2026-09-01) Confetti overlay stage dihapus - lihat komentar di titik input
    // (di atas, dekat subscribeAccentStart) utk alasan lengkap.
    if (opts.ctaText && bellInputIdx !== null) {
      filterStages.push(
        ...buildSubscribeButtonFilterStages(bellInputIdx, opts.ctaText, TARGET_WIDTH, TARGET_HEIGHT, outputDurationSeconds, curLabel, "vout")
      );
      curLabel = "vout";
    } else {
      filterStages.push(`[${curLabel}]null[vout]`);
      curLabel = "vout";
    }
    // Durasi output = MAX(video, audio), bukan cuma video (2026-08-07 fix, DIPERLUAS
    // 2026-08-10 - lihat needsVideoLoop di atas). Kasus asli 2026-08-07: video Laundry
    // In Bali yg sudah dibudget >=33dtk tetap keluar cuma 23-28dtk krn "-shortest" bikin
    // video ikut TERPOTONG kalau audio TTS (caption pendek -> baca cepat) lebih pendek
    // dari visual - fix-nya: audio pendek diisi SILENCE (apad) sampai minimal sepanjang
    // video. Kasus BARU 2026-08-10 (laporan Agus - "narasi sampai tengah sudah habis"):
    // kebalikannya - audio (narasi PANJANG, YouTube Editorial Engine) lebih panjang dari
    // video (footage stok kehabisan sebelum capai target) - video di-LOOP (lihat
    // needsVideoLoop) supaya narasi TIDAK PERNAH terpotong gara-gara footage kurang.
    // Tunda narasi (2026-08-11, adelay - lihat NARRATION_LEAD_IN_SECONDS di
    // lowerThird.ts & catatan leadInSeconds di atas) - `all=1` supaya 1 nilai delay
    // dipakai ke SEMUA channel audio apa pun jumlah channelnya (mono/stereo TTS),
    // drpd pola "ms|ms" yg WAJIB tahu channel count di muka. Label diganti SEKALI di
    // sini, dipakai di kedua cabang (dgn/tanpa musik) di bawah - drpd duplikasi delay
    // filter di 2 tempat.
    const leadInMs = Math.round(leadInSeconds * 1000);
    let voiceLabel = audioInputIdx !== null ? `${audioInputIdx}:a` : null;
    if (leadInMs > 0 && audioInputIdx !== null) {
      filterStages.push(`[${audioInputIdx}:a]adelay=${leadInMs}:all=1[voice_delayed]`);
      voiceLabel = "voice_delayed";
    }
    if (audioInputIdx !== null && musicInputIdx !== null) {
      // Duck otomatis (sidechaincompress) - volume musik TURUN sendiri saat sidechain
      // [narasi] py suara, NAIK lagi saat narasi jeda - bukan cuma volume statis rendah
      // sepanjang video (musik akan kedengaran "mati" total di bagian tanpa narasi kalau
      // volumenya statis rendah). Fade in/out 1.5dtk di awal/akhir + volume dasar 0.5
      // (sebelum duck) biar musik tetap jadi "latar", bukan menyaingi narasi bahkan saat
      // paling kencang.
      const fadeOutStart = Math.max(0, outputDurationSeconds - 1.5);
      filterStages.push(
        `[${musicInputIdx}:a]afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1.5,volume=0.5[music_pre]`
      );
      // asplit WAJIB (2026-08-11, bug nyata ditemukan lewat tes langsung - voiceLabel
      // dipakai 2x di bawah [sidechaincompress & apad], TAPI beda dari "[N:a]" stream
      // specifier mentah [yg BOLEH dipakai berkali2 tanpa split, dites terpisah],
      // label HASIL FILTER [adelay] TIDAK BOLEH dipakai lebih dari sekali - ffmpeg
      // error "Invalid stream specifier" pas dicoba. asplit=2 duplikasi stream-nya
      // dulu jadi 2 label terpisah, baru masing2 dipakai SEKALI.
      filterStages.push(`[${voiceLabel}]asplit=2[voice_sc][voice_mix]`);
      filterStages.push(
        `[music_pre][voice_sc]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[music_ducked]`
      );
      filterStages.push(`[voice_mix]apad[voice_padded]`);
      filterStages.push(`[voice_padded][music_ducked]amix=inputs=2:duration=longest:weights=1.4 1[mixed]`);
      filterStages.push(`[mixed]${LOUDNORM_FILTER}[aout]`);
      finalArgs.push("-filter_complex", filterStages.join(";"));
      finalArgs.push("-map", "[vout]", "-map", "[aout]");
    } else if (audioInputIdx !== null) {
      filterStages.push(`[${voiceLabel}]apad[voice_padded]`);
      filterStages.push(`[voice_padded]${LOUDNORM_FILTER}[aout]`);
      finalArgs.push("-filter_complex", filterStages.join(";"));
      finalArgs.push("-map", "[vout]", "-map", "[aout]");
    } else {
      finalArgs.push("-filter_complex", filterStages.join(";"));
      finalArgs.push("-map", "[vout]");
    }
    finalArgs.push("-t", String(outputDurationSeconds));
    // -movflags +faststart (2026-08-10, bug nyata ditemukan - laporan Agus publish
    // ditolak "Video must be no longer than 3 minutes for YouTube Shorts" utk video
    // LANDSCAPE 438dtk, jelas bukan Shorts asli). Root cause dikonfirmasi langsung:
    // moov atom (metadata durasi/dimensi MP4) DEFAULT ditulis ffmpeg di AKHIR file
    // (setelah mdat/data video, bisa ratusan MB) - dicek langsung: byte "moov" TIDAK
    // ada di 64KB pertama file hasil render. Layanan luar (Buffer/YouTube) yg probe
    // metadata via partial/range fetch (praktik umum utk file besar, drpd download
    // semua) GAGAL nemu moov, kemungkinan besar fallback ke asumsi salah (termasuk
    // klasifikasi Shorts). Fix: pindah moov ke AWAL file ("web-optimized"/"fast
    // start", praktik standar video utk streaming) - metadata kebaca instan tanpa
    // perlu file lengkap.
    finalArgs.push("-movflags", "+faststart");
    finalArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-pix_fmt", "yuv420p", finalPath);
    await run("ffmpeg", finalArgs);

    const durationSeconds = Math.round(await getDurationSeconds(finalPath));

    const buffer = await readFile(finalPath);
    const key = buildAssetKey(opts.brandId, opts.projectId, "final.mp4");
    const videoUrl = await uploadBuffer(key, buffer, "video/mp4");

    return { videoUrl, durationSeconds };
  } finally {
    // Best-effort cleanup - biarkan proses render sukses/gagal tidak tergantung ke ini.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
