import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { ScoredSegment } from "@/lib/ai/clipSelect";
import type { WordTiming } from "@/lib/ai/transcribe";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { buildCircularLogoPng, LOGO_SIZE_RATIO, LOGO_MARGIN_RATIO } from "@/lib/ai/logoOverlay";
import { buildWordHighlightAss, buildStaticAss, DEFAULT_SUBTITLE_DESIGN } from "./subtitleDesign";

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
export type VideoOrientation = "portrait" | "landscape";

function getTargetDimensions(orientation: VideoOrientation): { width: number; height: number } {
  return orientation === "landscape" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

// Style subtitle - lihat subtitleDesign.ts (Subtitle Designer, 2026-08-10, permintaan
// Agus - engine ASS word-highlight+pop gaya TikTok/YT Shorts). PENTING (bug nyata
// ditemukan lewat tes visual langsung - bukan cuma baca dokumentasi, masih relevan):
// filter "subtitles=file.srt:force_style=..." TIDAK predictable - MarginV/Fontsize di
// situ dihitung relatif ke resolusi INTERNAL kecil yg diasumsikan libass utk SRT polos
// (bukan resolusi video asli), jadi angka wajar spt MarginV=760 malah mendorong teks
// JAUH keluar frame sama sekali (invisible, bukan error). Solusinya (tetap dipakai):
// bikin file .ass EKSPLISIT dgn PlayResX/PlayResY = resolusi video SUNGGUHAN.

async function run(cmd: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr || "";
    throw new Error(`${cmd} gagal: ${(err as Error).message}\n${stderr.slice(-2000)}`);
  }
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
    for (const [i, clip] of allClips.entries()) {
      const duration = Math.max(0.2, clip.end - clip.start);
      const outPath = path.join(workDir, `clip_${i}.mp4`);
      await run("ffmpeg", [
        "-y",
        "-ss", String(clip.start),
        "-i", clip.url,
        "-t", String(duration),
        "-vf", `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1,fps=30`,
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        outPath,
      ]);
      normalizedPaths.push(outPath);
    }

    // 2) Concat (semua input SUDAH seragam codec/resolusi/fps - concat DEMUXER cukup,
    // stream-copy tanpa re-encode ulang, jauh lebih cepat drpd filter concat).
    const concatListPath = path.join(workDir, "concat.txt");
    await writeFile(concatListPath, normalizedPaths.map((p) => `file '${escapeFilterPath(p)}'`).join("\n"));
    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", concatenatedPath]);
    const videoDurationSeconds = await getDurationSeconds(concatenatedPath);

    // 3) Subtitle -> .ass eksplisit (Subtitle Designer, lihat subtitleDesign.ts - WAJIB
    // .ass eksplisit, bukan subtitles=+force_style yg terbukti nyata tidak predictable
    // posisi/ukurannya). wordTimings ADA -> caption "kata per kata" gaya TikTok/YT
    // Shorts, kosong -> fallback statis dari srtContent (tetap ikut Subtitle Designer
    // utk font/warna/posisi, cuma tanpa animasi per-kata).
    const assPath = path.join(workDir, "subtitles.ass");
    const assContent =
      opts.wordTimings && opts.wordTimings.length > 0
        ? buildWordHighlightAss(opts.wordTimings, DEFAULT_SUBTITLE_DESIGN, TARGET_WIDTH, TARGET_HEIGHT)
        : buildStaticAss(parseSrt(opts.srtContent), DEFAULT_SUBTITLE_DESIGN, TARGET_WIDTH, TARGET_HEIGHT);
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
    // Nama file ".wav" (2026-08-10, sebelumnya ".mp3" dari era OpenAI tts-1 - Kokoro
    // TTS/dubbing.ts sekarang balikin WAV asli) - ffmpeg sendiri probe isi FILE bukan
    // ekstensi utk input (`-i`), jadi ekstensi salah TIDAK PERNAH benar2 gagal decode,
    // ini murni supaya nama file jujur soal isinya, bukan perbaikan bug fungsional.
    let audioPath: string | null = null;
    let audioDurationSeconds = 0;
    if (opts.voiceoverAudioBuffer) {
      audioPath = path.join(workDir, "voiceover.wav");
      await writeFile(audioPath, opts.voiceoverAudioBuffer);
      audioDurationSeconds = await getDurationSeconds(audioPath);
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
    const outputDurationSeconds = Math.max(videoDurationSeconds, audioDurationSeconds);

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
      finalArgs.push("-i", logoPath);
      logoInputIdx = nextInputIdx++;
    }
    let audioInputIdx: number | null = null;
    if (audioPath) {
      finalArgs.push("-i", audioPath);
      audioInputIdx = nextInputIdx++;
    }

    const logoMargin = Math.round(TARGET_WIDTH * LOGO_MARGIN_RATIO);
    const filterStages: string[] = [];
    let curLabel = "0:v";
    const subLabel = logoInputIdx !== null ? "subbed" : "vout";
    filterStages.push(`[${curLabel}]ass=${escapeFilterPath(assPath)}[${subLabel}]`);
    curLabel = subLabel;
    if (logoInputIdx !== null) {
      filterStages.push(`[${logoInputIdx}:v]format=rgba[logofmt]`);
      filterStages.push(`[${curLabel}][logofmt]overlay=W-w-${logoMargin}:${logoMargin}[vout]`);
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
    if (audioInputIdx !== null) {
      filterStages.push(`[${audioInputIdx}:a]apad[aout]`);
      finalArgs.push("-filter_complex", filterStages.join(";"));
      finalArgs.push("-map", "[vout]", "-map", "[aout]");
    } else {
      finalArgs.push("-filter_complex", filterStages.join(";"));
      finalArgs.push("-map", "[vout]");
    }
    finalArgs.push("-t", String(outputDurationSeconds));
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
