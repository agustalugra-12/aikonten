import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { ScoredSegment } from "@/lib/ai/clipSelect";
import { generateVoiceover } from "@/lib/ai/dubbing";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

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

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920; // vertikal (9:16) - sama dgn Cloudinary sebelumnya (c_fill 1080x1920)

// Style subtitle (2026-08-05, permintaan Agus - "kecilkan 50%, posisi tengah-tengah
// video, turunkan sedikit"). PENTING (bug nyata ditemukan lewat tes visual langsung -
// bukan cuma baca dokumentasi): filter "subtitles=file.srt:force_style=..." TIDAK
// predictable - MarginV/Fontsize di situ dihitung relatif ke resolusi INTERNAL kecil yg
// diasumsikan libass utk SRT polos (bukan resolusi video asli), jadi angka wajar spt
// MarginV=760 malah mendorong teks JAUH keluar frame sama sekali (invisible, bukan
// error - makanya nyaris tidak ketahuan tanpa cek visual). Solusinya: bikin file .ass
// EKSPLISIT dgn PlayResX/PlayResY = resolusi video SUNGGUHAN, style Alignment=2 (bottom-
// center) + MarginV dihitung dari SITU - jadi predictable & dites benar2 pas di tengah-
// bawah lewat rendering nyata sblm dipakai di pipeline.
const SUBTITLE_FONT_SIZE = 26; // ~50% dari ukuran umum caption video vertikal (biasanya ~50-56px)
const SUBTITLE_MARGIN_V = 760; // dari tepi bawah, dlm skala PlayResY=1920 sungguhan - diuji visual: jatuh di ~tengah, sedikit di bawah tengah asli

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

// Konversi SRT (format yg SUDAH dipakai buildCaptionSrt, lihat generateContent.ts) jadi
// .ass EKSPLISIT dgn PlayResX/PlayResY = resolusi video sungguhan (lihat catatan
// SUBTITLE_FONT_SIZE di atas kenapa ini WAJIB, bukan sekadar preferensi gaya).
function buildAssContent(srtContent: string): string {
  const entries = parseSrt(srtContent);
  const header =
    `[Script Info]\nPlayResX: ${TARGET_WIDTH}\nPlayResY: ${TARGET_HEIGHT}\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,Arial,${SUBTITLE_FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,${SUBTITLE_MARGIN_V},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = entries.map((e) => `Dialogue: 0,${e.start},${e.end},Default,,0,0,0,,${e.text}`).join("\n");
  return header + events + "\n";
}

export async function renderFinalVideo(opts: {
  projectId: string;
  brandId: string;
  segments: (ScoredSegment & { sourceUrl: string })[];
  srtContent: string;
  brollClips?: Array<{ videoUrl: string; durationSeconds: number }>;
  voiceoverText?: string;
}): Promise<RenderResult> {
  if (opts.segments.length === 0) {
    throw new Error("Tidak ada klip footage asli terpilih utk dirender");
  }

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

    // 3) Subtitle -> .ass eksplisit (lihat buildAssContent - WAJIB, bukan subtitles=
    // +force_style yg terbukti nyata tidak predictable posisi/ukurannya).
    const assPath = path.join(workDir, "subtitles.ass");
    await writeFile(assPath, buildAssContent(opts.srtContent));

    // 4) AI Dubbing - GANTI TOTAL audio asli dgn TTS baca caption (lihat memory
    // proyek, keputusan eksplisit Agus) - reuse generateVoiceover yg sudah ada
    // (dubbing.ts, model tts-1 murah).
    let audioPath: string | null = null;
    if (opts.voiceoverText) {
      const voiceoverBuffer = await generateVoiceover(opts.voiceoverText);
      audioPath = path.join(workDir, "voiceover.mp3");
      await writeFile(audioPath, voiceoverBuffer);
    }

    // 5) Bakar subtitle + mux audio TTS. PENTING (bug nyata ditemukan lewat tes -
    // "-vf" simple-filter DIGABUNG dgn "-map" eksplisit bikin filter subtitle
    // SENYAP tidak pernah kepakai, walau tidak ada error sama sekali): WAJIB pakai
    // -filter_complex dgn label output eksplisit ([vout]) baru di-map, bukan -vf biasa.
    const finalPath = path.join(workDir, "final.mp4");
    const finalArgs = ["-y", "-i", concatenatedPath];
    if (audioPath) finalArgs.push("-i", audioPath);
    finalArgs.push("-filter_complex", `[0:v]ass=${escapeFilterPath(assPath)}[vout]`);
    finalArgs.push("-map", "[vout]");
    if (audioPath) {
      finalArgs.push("-map", "1:a", "-shortest");
    }
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
