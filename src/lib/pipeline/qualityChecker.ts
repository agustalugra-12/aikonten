import { runFfmpeg } from "@/lib/render/ffmpegExec";

// Quality Checker (2026-08-10, PRD "AI Content Editing Engine" section 32) - jaring
// pengaman TERAKHIR sebelum project ditandai "ready" (tampil di Draft Review, BISA
// auto-publish). Dibangun LANGSUNG setelah insiden nyata hari ini: 3 video Animal
// Story & Co dgn narasi rusak (163 detik SUNYI - bug voiceover baca caption SEO,
// SUDAH diperbaiki di sumbernya tapi 3 video LAMA yg terlanjur rusak sempat ke-publish
// otomatis begitu koneksi native YouTube tersambung, krn TIDAK ADA pemeriksaan
// otomatis yg menahannya). Cek ini murni TEKNIS (durasi/silence/aset ada-tidaknya) -
// BUKAN cek kualitas konten/kreatif (itu ranah review manual Agus di Draft Review).
//
// 2026-08-10 (lanjutan) - PRD section 32 sebenarnya minta 8 pemeriksaan, v1 di atas
// cuma implementasi 2 (durasi+silence). Ditambah di sini: audio kepelanan (mean
// volume), footage kosong/hitam (blackdetect), subtitle kosong, subtitle kepanjangan
// (baris SRT >2x batas wajar burst ASS - lihat subtitleDesign.ts). "Transisi gagal"/
// "logo hilang" dari PRD SENGAJA tidak diimplementasi sbg cek video-analysis terpisah
// (butuh computer vision, bukan proporsional) - keduanya sudah punya jaring pengaman
// lain: logo cuma dilewati kalau brand.logoUrl kosong (lihat ffmpeg.ts, bukan "hilang"
// tak sengaja), transisi dibangun deterministik dari AI Director (tidak ada jalur
// gagal-diam - filter_complex error akan melempar exception render, bukan lolos diam2).
// Klasifikasi fixability (2026-08-12, Fase 2c PRD Animal Story & Co section 9/10/21/22/42
// - "jangan reject, coba perbaiki dulu... reject HANYA kalau masalahnya material"). Versi
// lama: SEMUA issue = 1 boolean `passed`, satu issue apa pun (termasuk yg borderline/
// remeh) = reject total, render yg SUDAH JADI (sudah kena biaya) dibuang. Sekarang tiap
// issue diklasifikasi:
// - "retry_subtitle_only": SRT kosong/baris kepanjangan - BISA diperbaiki murah (re-
//   transkripsi audio yg SUDAH ADA, TANPA render ulang video) - lihat processProject.ts.
// - "warn": borderline/tidak cukup parah utk dibuang (mis. sunyi 8-12dtk, hitam 2-4dtk,
//   volume -35 s/d -30dB) - dicatat (autoFixLog), TIDAK menahan status "ready".
// - "hard_reject": genuinely material (durasi jauh di bawah minimum, sunyi/hitam/volume
//   PARAH) - PRD sendiri sebutkan "render/audio total failure" sbg alasan reject sah.
export type QualityIssue = {
  code: string;
  message: string;
  fixability: "retry_subtitle_only" | "warn" | "hard_reject";
};

export type QualityCheckResult = {
  passed: boolean;
  issues: string[]; // gabungan semua issue.message, dipertahankan utk backward-compat (errorMessage dsb)
  structured: QualityIssue[];
};

// Ambang sunyi (2026-08-10) - >8 detik sunyi BERTURUT-TURUT dianggap cacat (jeda wajar
// antar kalimat narasi TTS biasanya <2dtk, 8dtk jauh di atas itu - insiden asli 163dtk
// jauh melebihi ambang ini, margin aman dari false-positive jeda wajar).
const MAX_SILENCE_SECONDS = 8;

// Ambang audio kepelanan (2026-08-10) - mean_volume dari ffmpeg volumedetect. Video
// normal (narasi TTS + musik latar ter-duck) biasanya mean_volume di kisaran -20dB
// s/d -14dB. -35dB dipilih sbg ambang (BUKAN sama dgn threshold silencedetect di atas
// yg mengukur noise floor per-frame) - jauh di bawah kisaran wajar, menangkap kasus
// audio ke-mute/gain salah TANPA silencedetect ikut trigger (mis. audio pelan TAPI
// terus-menerus, bukan jeda diam).
const MIN_MEAN_VOLUME_DB = -35;

// Ambang footage kosong/hitam (2026-08-10, direvisi 2026-11-06) - blackdetect d=1
// (pic_th=0.98 -> 98% piksel gelap) menandai KANDIDAT hitam, TAPI itu saja tidak cukup:
// adegan GELAP disengaja (malam, bawah laut, makhluk kegelapan) jg 98% piksel gelap ->
// dulu ditolak keliru, buang 1,5-2 jam render (lihat insiden backlog). Sekarang kandidat
// dikonfirmasi dgn signalstats YMAX (piksel PALING TERANG di frame): hitam SUNGGUHAN
// (klip gagal dimuat/corrupt) = YMAX pun ~floor (limited-range black Y=16); adegan gelap
// disengaja SELALU punya highlight (bulan/pantulan/tepi subjek) -> YMAX tinggi, dilewati.
// Ambang relatif ke ISI frame, bukan rata-rata kecerahan global. Rentang HITAM SUNGGUHAN
// berturut >2dtk = cacat.
const MAX_BLACK_SECONDS = 2;
// YMAX (0-255, 8-bit) di bawah/sama ini = frame tanpa piksel terang sama sekali = hitam
// sungguhan. 24 = floor black 16 + margin noise kompresi. Di atas ini = ada highlight =
// adegan gelap artistik, BUKAN footage rusak.
const TRUE_BLACK_YMAX = 24;

// Ambang panjang baris subtitle (2026-08-10) - burst ASS di-wrap maks 2 baris
// (DEFAULT_SUBTITLE_DESIGN.maxLines, lihat subtitleDesign.ts), tapi ITU logika
// wrap-per-burst kata, bukan validasi kalimat SRT sumber. Di sini cek kasar di level
// SRT MENTAH (sebelum di-burst): 1 baris SRT >140 karakter mengindikasikan caption
// generator gagal memecah kalimat (akan menghasilkan burst yg sangat padat/terlalu
// cepat dibaca), bukan angka presisi UI - cukup utk menangkap kasus ekstrem.
const MAX_SRT_LINE_CHARS = 140;

// Fase 3 (2026-08-31): SEMUA detector di bawah jalan lewat wrapper ffmpegExec (profil
// util: MemoryMax/SwapMax/cgroup + timeout + semaphore global) - dulu 3x execFileAsync
// telanjang TANPA timeout/cgroup, 1 cek macet = project menggantung selamanya.
// Filter, threshold, & pola parse stderr (termasuk parse err.stderr saat ffmpeg gagal
// - stderr kini di-attach ke error oleh ffmpegExec, lihat sana) SAMA PERSIS -
// keputusan QC tidak berubah, hanya kebijakan resource eksekusinya.
// Probe video SATU PASS (2026-11-06) - dulu 3 pass ffmpeg terpisah (silencedetect,
// volumedetect, blackdetect), tiap pass men-decode ULANG video final dari R2 (mahal utk
// long-form ~400dtk). Sekarang satu decode: -af silencedetect,volumedetect + -vf
// blackdetect,signalstats. Hemat ~2-3x decode penuh per QC. Keputusan QC (ambang) TIDAK
// berubah - cuma jumlah decode-nya. signalstats menyalurkan YMAX per-frame (via
// metadata=print, ke stderr - buffer ffmpegExec 64MB, tidak terpotong) utk membedakan
// hitam sungguhan vs adegan gelap artistik (lihat computeTrueBlackSeconds).
type VideoProbe = { longestSilence: number; meanVolume: number | null; trueBlackSeconds: number };

async function probeVideo(videoUrl: string): Promise<VideoProbe> {
  const { stderr } = await runFfmpeg(
    [
      "-i", videoUrl,
      "-af", `silencedetect=noise=-35dB:d=${MAX_SILENCE_SECONDS},volumedetect`,
      "-vf", "blackdetect=d=1:pic_th=0.98,signalstats,metadata=print:key=lavfi.signalstats.YMAX",
      "-f", "null", "-",
    ],
    "util"
  ).catch((err) => ({ stderr: (err as { stderr?: string })?.stderr || "", stdout: "" }));

  const silences = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const vol = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  // blackdetect (98% piksel gelap) = GERBANG murah: tak ada kandidat hitam sama sekali ->
  // pasti bukan footage rusak, lewati konfirmasi YMAX. Ada kandidat -> baru dibedakan hitam
  // SUNGGUHAN vs adegan gelap artistik lewat YMAX (computeTrueBlackSeconds). Dua sinyal.
  const hasBlackCandidate = /black_duration:\s*[\d.]+/.test(stderr);
  return {
    longestSilence: silences.length > 0 ? Math.max(...silences) : 0,
    meanVolume: vol ? parseFloat(vol[1]) : null,
    trueBlackSeconds: hasBlackCandidate ? computeTrueBlackSeconds(stderr) : 0,
  };
}

// Rentang BERTURUT terpanjang (detik) di mana frame TAK punya piksel terang sama sekali
// (YMAX <= TRUE_BLACK_YMAX) = hitam sungguhan. blackdetect saja menandai adegan gelap
// artistik sbg hitam; di sini DISARING pakai YMAX (highlight tetap = bukan hitam). Durasi
// diukur dari pts_time (bukan asumsi fps). Diekspor utk test (fase5). Parse dari stderr
// ffmpeg combined-pass: baris "...pts_time:X" lalu "lavfi.signalstats.YMAX=Y", urut per frame.
export function computeTrueBlackSeconds(ffmpegStderr: string): number {
  const times = [...ffmpegStderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ymax = [...ffmpegStderr.matchAll(/lavfi\.signalstats\.YMAX=([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const n = Math.min(times.length, ymax.length);
  let longest = 0;
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    if (ymax[i] <= TRUE_BLACK_YMAX) {
      if (runStart < 0) runStart = times[i];
      longest = Math.max(longest, times[i] - runStart);
    } else {
      runStart = -1;
    }
  }
  return longest;
}

// Cek subtitle di level SRT MENTAH (sebelum jadi .ass) - dipanggil sblm render
// selesai butuh koneksi jaringan, jadi murni sinkron/string parsing, cepat.
function checkSrtContent(srtContent: string): string[] {
  const issues: string[] = [];
  const trimmed = srtContent.trim();
  if (trimmed.length === 0) {
    issues.push("Subtitle kosong (SRT tidak berisi caption sama sekali)");
    return issues;
  }
  const lines = trimmed.split("\n");
  const overlyLong = lines.find((l) => l.length > MAX_SRT_LINE_CHARS);
  if (overlyLong) {
    issues.push(
      `Ada baris subtitle >${MAX_SRT_LINE_CHARS} karakter (kemungkinan gagal dipecah per-kalimat, caption akan terlalu padat)`
    );
  }
  return issues;
}

// Dipanggil SETELAH render final selesai (processProject.ts) - videoUrl SUDAH live di
// R2, minDurationSeconds dari durationConfig.min yg sudah dipakai konsisten di seluruh
// pipeline (bukan angka baru terpisah). srtContent OPSIONAL (caller lama/tanpa
// subtitle presisi tetap bisa panggil tanpa cek subtitle - lihat processProject.ts).
// Ambang "warn, bukan hard-fail" (2026-08-12, Fase 2c) - borderline case yg dekat batas
// asli TAPI belum genuinely material. Sunyi 8-12dtk / hitam 2-4dtk / volume -35 s/d
// -30dB dicatat sbg warning (autoFixLog), TIDAK menahan status "ready" - selaras
// prinsip PRD "jangan reject krn tidak sempurna, reject HANYA krn material." Melebihi
// batas warn ini baru genuinely hard_reject.
const SILENCE_WARN_MAX_SECONDS = 12;
const BLACK_WARN_MAX_SECONDS = 4;
const MEAN_VOLUME_WARN_MIN_DB = -30;

export async function runVideoQualityChecks(
  videoUrl: string,
  actualDurationSeconds: number,
  minDurationSeconds: number,
  srtContent?: string
): Promise<QualityCheckResult> {
  const structured: QualityIssue[] = [];

  if (actualDurationSeconds < minDurationSeconds) {
    // Bukan retry murah di sini (butuh render ulang penuh) - caller (processProject.ts)
    // yg memutuskan apakah mau reroute lewat ladder Fase 2b, cek ini cuma melaporkan.
    structured.push({
      code: "duration_short",
      message: `Durasi video ${Math.round(actualDurationSeconds)}dtk di bawah minimum ${minDurationSeconds}dtk`,
      fixability: "hard_reject",
    });
  }

  if (srtContent !== undefined) {
    for (const msg of checkSrtContent(srtContent)) {
      structured.push({ code: "srt_content", message: msg, fixability: "retry_subtitle_only" });
    }
  }

  // Satu pass ffmpeg utk silence+volume+hitam (lihat probeVideo - dulu 3 pass terpisah).
  // Gagal probe TIDAK BOLEH menggagalkan project (mis. ffmpeg sesaat error) - dicatat
  // warning, bukan hard_reject, drpd macet total krn pemeriksaan tambahan gagal.
  let probe: VideoProbe | null = null;
  try {
    probe = await probeVideo(videoUrl);
  } catch (err) {
    structured.push({
      code: "probe_check_error",
      message: `Gagal menjalankan cek teknis video (silence/volume/hitam): ${err instanceof Error ? err.message : String(err)}`,
      fixability: "warn",
    });
  }

  if (probe) {
    const { longestSilence, meanVolume, trueBlackSeconds } = probe;

    if (longestSilence > SILENCE_WARN_MAX_SECONDS) {
      structured.push({
        code: "silence",
        message: `Ada jeda sunyi ${Math.round(longestSilence)} detik di audio (narasi kemungkinan terputus/tidak menutupi seluruh video)`,
        fixability: "hard_reject",
      });
    } else if (longestSilence > MAX_SILENCE_SECONDS) {
      structured.push({
        code: "silence",
        message: `Ada jeda sunyi ${Math.round(longestSilence)} detik di audio (borderline, di bawah batas parah)`,
        fixability: "warn",
      });
    }

    if (meanVolume !== null && meanVolume < MIN_MEAN_VOLUME_DB) {
      structured.push({
        code: "mean_volume",
        message: `Volume audio terlalu pelan (rata-rata ${meanVolume.toFixed(1)}dB, di bawah ambang ${MIN_MEAN_VOLUME_DB}dB)`,
        fixability: "hard_reject",
      });
    } else if (meanVolume !== null && meanVolume < MEAN_VOLUME_WARN_MIN_DB) {
      structured.push({
        code: "mean_volume",
        message: `Volume audio agak pelan (rata-rata ${meanVolume.toFixed(1)}dB, borderline)`,
        fixability: "warn",
      });
    }

    // Hitam SUNGGUHAN (sudah disaring YMAX - adegan gelap artistik TIDAK masuk sini, jadi
    // tidak lagi false-positive menolak konten bertema malam/bawah laut).
    if (trueBlackSeconds > BLACK_WARN_MAX_SECONDS) {
      structured.push({
        code: "black_frames",
        message: `Ada ${Math.round(trueBlackSeconds)} detik layar hitam sungguhan (footage kemungkinan gagal dimuat/corrupt)`,
        fixability: "hard_reject",
      });
    } else if (trueBlackSeconds > MAX_BLACK_SECONDS) {
      structured.push({
        code: "black_frames",
        message: `Ada ${Math.round(trueBlackSeconds)} detik layar hitam sungguhan (borderline, di bawah batas parah)`,
        fixability: "warn",
      });
    }
  }

  const hardFails = structured.filter((i) => i.fixability === "hard_reject" || i.fixability === "retry_subtitle_only");
  return {
    passed: hardFails.length === 0,
    issues: structured.map((i) => i.message),
    structured,
  };
}
