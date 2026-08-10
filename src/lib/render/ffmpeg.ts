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
import { buildCameraMotionFilter, ALL_MOTION_TYPES, type MotionType } from "./cameraMotion";
import { buildXfadeFilterComplex, type TransitionType } from "./transitions";
import { buildProgressBarFilter, buildCtaTextFilter } from "./overlayEngine";

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
  // Batas keras durasi output (2026-08-10, permintaan Agus "jangan buat short diatas 1
  // menit") - lihat catatan lengkap di dekat outputDurationSeconds di bawah.
  maxDurationSeconds?: number;
  // Overlay Engine (2026-08-10, PRD "AI Content Editing Engine") - lihat
  // overlayEngine.ts. Keduanya OPSIONAL & independen - showProgressBar default false
  // (tidak ada perubahan visual kalau caller tidak minta), ctaText default tidak ada
  // teks CTA sama sekali kalau kosong/undefined.
  showProgressBar?: boolean;
  ctaText?: string;
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
      await run("ffmpeg", [
        "-y",
        "-ss", String(clip.start),
        "-i", clip.url,
        "-t", String(duration),
        "-vf", buildCameraMotionFilter(motion, TARGET_WIDTH, TARGET_HEIGHT, duration),
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        outPath,
      ]);
      normalizedPaths.push(outPath);
      // Durasi AKTUAL hasil encode (bukan asumsi `duration` yg diminta) - frame
      // rounding di fps=30 bisa geser sepersekian detik, xfade offset WAJIB akurat
      // (lihat transitions.ts) drpd ikut menyimpang sedikit demi sedikit tiap klip.
      normalizedDurations.push(await getDurationSeconds(outPath));
    }

    // 2) Sambung klip PAKAI TRANSISI (xfade, 2026-08-10 - lihat transitions.ts kenapa
    // BUKAN lagi concat demuxer polos "-c copy". WAJIB re-encode di sini (xfade tidak
    // bisa stream-copy), lebih lambat drpd demuxer tapi hasilnya ada transisi
    // sungguhan, bukan cuma hard-cut).
    const { filterComplex, outputLabel, totalDurationSeconds: estimatedDuration } = buildXfadeFilterComplex(
      normalizedDurations,
      opts.transitions || []
    );
    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    if (normalizedPaths.length === 1) {
      await run("ffmpeg", ["-y", "-i", normalizedPaths[0], "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", concatenatedPath]);
    } else {
      const inputArgs = normalizedPaths.flatMap((p) => ["-i", p]);
      await run("ffmpeg", [
        "-y",
        ...inputArgs,
        "-filter_complex", filterComplex,
        "-map", `[${outputLabel}]`,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        concatenatedPath,
      ]);
    }
    void estimatedDuration; // dihitung ulang dari file ASLI di bawah (lebih akurat drpd estimasi filter chain)
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
    if (opts.musicUrl && audioInputIdx !== null) {
      finalArgs.push("-stream_loop", "-1", "-i", opts.musicUrl);
      musicInputIdx = nextInputIdx++;
    }

    const logoMargin = Math.round(TARGET_WIDTH * LOGO_MARGIN_RATIO);
    const filterStages: string[] = [];
    let curLabel = "0:v";
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
    if (opts.showProgressBar) {
      filterStages.push(`[${curLabel}]${buildProgressBarFilter(TARGET_WIDTH, TARGET_HEIGHT, outputDurationSeconds)}[barred]`);
      curLabel = "barred";
    }
    if (opts.ctaText) {
      filterStages.push(`[${curLabel}]${buildCtaTextFilter(opts.ctaText, TARGET_WIDTH, TARGET_HEIGHT, outputDurationSeconds)}[vout]`);
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
      filterStages.push(
        `[music_pre][${audioInputIdx}:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[music_ducked]`
      );
      filterStages.push(`[${audioInputIdx}:a]apad[voice_padded]`);
      filterStages.push(`[voice_padded][music_ducked]amix=inputs=2:duration=longest:weights=1.4 1[mixed]`);
      filterStages.push(`[mixed]${LOUDNORM_FILTER}[aout]`);
      finalArgs.push("-filter_complex", filterStages.join(";"));
      finalArgs.push("-map", "[vout]", "-map", "[aout]");
    } else if (audioInputIdx !== null) {
      filterStages.push(`[${audioInputIdx}:a]apad[voice_padded]`);
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
