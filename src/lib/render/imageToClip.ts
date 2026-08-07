import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { readFile } from "fs/promises";

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr || "";
    throw new Error(`${cmd} gagal: ${(err as Error).message}\n${stderr.slice(-2000)}`);
  }
}

// Foto -> klip video pendek dgn efek zoom/pan (2026-08-07, permintaan Agus - "footage
// jangan monoton untuk semua brand... silahkan gunakan footage foto sebagai video tidak
// apa namun tambahkan efek seperti zoom in zoom out pan"). SEBELUM ini sudah ADA fungsi
// serupa (applyZoomToImage, cloudinary.ts, dibuat 2026-07-31) TAPI: (1) TIDAK PERNAH
// benar2 dipanggil di pipeline manapun (dicek langsung - nol call site di seluruh
// codebase, murni kode mati), (2) cuma 1 variasi (zoom-in-center doang, "zoom in zoom
// out pan atau lainnya" minta LEBIH dari itu), (3) pakai Cloudinary berbayar padahal
// render final SUDAH dimigrasi ke FFmpeg lokal gratis (2026-08-05, "migrasi agar
// prosesnya free") - fungsi lama ini jadi satu2nya sisa yg masih nyeret Cloudinary utk
// hal yg FFmpeg lokal sanggup kerjakan sendiri.
//
// 4 varian (dirotasi per foto, lihat pemanggil) - zoompan filter FFmpeg standar:
// scale dulu ke resolusi besar (zoompan kualitasnya jelek kalau langsung di foto asli
// beresolusi variatif), baru zoompan, `d`=total frame, `on`=frame ke-berapa (0-indexed).
// `d` (total frame zoompan) TIDAK bisa dipakai di dalam ekspresi x/y (dites langsung -
// error "Undefined constant... in 'd-1)'" - beda dari z/x/y yg boleh pakai on/iw/ih/zoom,
// `d` cuma parameter luar) - makanya xExpr/yExpr fungsi(totalFrames) yg disisipkan
// sbg ANGKA LITERAL saat build filter string, bukan referensi simbol `d`.
const ZOOM_PAN_VARIANTS: Array<{ name: string; zExpr: string; xExpr: (totalFrames: number) => string; yExpr: string }> = [
  { name: "zoom-in-center", zExpr: "min(zoom+0.0015,1.3)", xExpr: () => "iw/2-(iw/zoom/2)", yExpr: "ih/2-(ih/zoom/2)" },
  { name: "zoom-out-center", zExpr: "if(eq(on,0),1.3,max(zoom-0.0015,1.0))", xExpr: () => "iw/2-(iw/zoom/2)", yExpr: "ih/2-(ih/zoom/2)" },
  { name: "pan-left-to-right", zExpr: "1.15", xExpr: (d) => `(iw-iw/zoom)*on/${Math.max(1, d - 1)}`, yExpr: "ih/2-(ih/zoom/2)" },
  { name: "pan-right-to-left", zExpr: "1.15", xExpr: (d) => `(iw-iw/zoom)*(1-on/${Math.max(1, d - 1)})`, yExpr: "ih/2-(ih/zoom/2)" },
];

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal ambil foto: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// Rotasi varian per foto (2026-08-07) - hash sederhana dari URL foto, BUKAN Math.random()
// murni, supaya foto yg SAMA (kalau kepakai lagi di masa depan, jarang krn ada anti-
// monoton) dapat efek KONSISTEN, bukan berubah-ubah acak tiap kali - tetap terasa
// "bervariasi ANTAR foto" (itu yg diminta), bukan variasi tak terprediksi per foto yg sama.
function pickVariant(imageUrl: string): (typeof ZOOM_PAN_VARIANTS)[number] {
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i++) hash = (hash * 31 + imageUrl.charCodeAt(i)) | 0;
  return ZOOM_PAN_VARIANTS[Math.abs(hash) % ZOOM_PAN_VARIANTS.length];
}

// Return sengaja SAMA bentuk dgn BrollResult (broll.ts)/brollClips (processProject.ts) -
// hasil fungsi ini ditaruh LANGSUNG di array brollClips sblm dikirim ke renderFinalVideo,
// TIDAK perlu perubahan apa pun di ffmpeg.ts (splice/normalize/concat sudah generik utk
// "video URL + durationSeconds" apa pun sumbernya, lihat allClips di ffmpeg.ts).
export async function imageToVideoClip(imageUrl: string, brandId: string, durationSeconds = 3.5): Promise<{ videoUrl: string; durationSeconds: number }> {
  const fps = 30;
  const totalFrames = Math.round(durationSeconds * fps);
  const variant = pickVariant(imageUrl);

  const workDir = await mkdtemp(path.join(tmpdir(), "kontenpilot_imgclip_"));
  try {
    const imgBuffer = await fetchBuffer(imageUrl);
    const imgPath = path.join(workDir, "source.jpg");
    await writeFile(imgPath, imgBuffer);

    const outPath = path.join(workDir, "clip.mp4");
    const zoompanFilter =
      `scale=3840:-2,` +
      `zoompan=z='${variant.zExpr}':x='${variant.xExpr(totalFrames)}':y='${variant.yExpr}':d=${totalFrames}:s=1080x1920:fps=${fps}`;

    await run("ffmpeg", [
      "-y", "-loop", "1", "-i", imgPath, "-t", String(durationSeconds),
      "-vf", zoompanFilter,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      outPath,
    ]);

    const outBuffer = await readFile(outPath);
    const key = buildAssetKey(brandId, "footage_zoom", `${variant.name}_${Date.now()}.mp4`);
    const videoUrl = await uploadBuffer(key, outBuffer, "video/mp4");
    return { videoUrl, durationSeconds };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
