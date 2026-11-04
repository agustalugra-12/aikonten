// Review frame lokal (Tahap 8): ambil frame detik 0, 1, 3, tengah, akhir + statistik luma + audio, contact
// sheet, dan keputusan QC (decideQc). Tanpa unggah ke mana pun. Pakai:
//   npx tsx scripts/hf-frame-review.ts <video.mp4> <dir-keluaran> [label]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decideQc, type FrameStat } from "../src/lib/video/renderQc";

const [mp4, out, label = "video"] = process.argv.slice(2);
if (!mp4 || !out) { console.error("pakai: hf-frame-review.ts <video.mp4> <dir> [label]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ffErr = (args: string[]) => String(spawnSync("ffmpeg", args, { encoding: "utf8" }).stderr || ""); // statistik ffmpeg ada di stderr

const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", mp4]));
const dur = Number(probe.format.duration);
const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
const hasAudio = probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio");
const times = [0, 1, 3, dur / 2, Math.max(0, dur - 0.15)].map((t) => Math.round(t * 100) / 100);
const frames: Array<FrameStat & { file: string }> = [];
for (const t of times) {
  const file = join(out, `${label}-t${t.toFixed(2)}.png`);
  sh("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", file]);
  const st = ffErr(["-v", "info", "-i", file, "-vf", "signalstats,metadata=print", "-f", "null", "-"]);
  const g = (k: string) => Number(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`).exec(st)?.[1] ?? NaN);
  frames.push({ t, yavg: g("YAVG"), yspread: g("YHIGH") - g("YLOW"), file });
}
const sheet = join(out, `${label}-sheet.jpg`);
sh("ffmpeg", ["-v", "error", "-y", ...frames.flatMap((f) => ["-i", f.file]), "-filter_complex", `${frames.map((_f, i) => `[${i}]scale=270:-2[s${i}]`).join(";")};${frames.map((_f, i) => `[s${i}]`).join("")}hstack=inputs=${frames.length}`, "-q:v", "3", sheet]);
let audio = { meanDb: NaN, maxDb: NaN, silences: [] as string[] };
if (hasAudio) {
  const vd = ffErr(["-i", mp4, "-vn", "-af", "volumedetect,silencedetect=noise=-45dB:d=1.2", "-f", "null", "-"]);
  audio = { meanDb: Number(/mean_volume: (-?[\d.]+)/.exec(vd)?.[1]), maxDb: Number(/max_volume: (-?[\d.]+)/.exec(vd)?.[1]), silences: [...vd.matchAll(/silence_start: ([\d.]+)/g)].map((m) => m[1]) };
}
const qc = decideQc({ renderError: null, frames, fallbackAvailable: true });
const report = { label, file: mp4, durationSeconds: dur, width: v?.width, height: v?.height, fps: v?.r_frame_rate, hasAudio, audio, frames, sheet, qc };
writeFileSync(join(out, `${label}-review.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ label, dur: dur.toFixed(2), size: `${v?.width}x${v?.height}`, audio: hasAudio ? `${audio.meanDb}dB mean, ${audio.maxDb}dB max, silence@${audio.silences.join("/") || "-"}` : "NO AUDIO", frames: frames.map((f) => `${f.t}s:Y${f.yavg.toFixed(0)}/±${f.yspread.toFixed(0)}`).join(" "), qc }));
