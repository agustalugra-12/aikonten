// QC render: footage benar-benar TAMPIL di jendela footage (bukan latar gradasi kosong). Ambil frame pada
// detik tertentu (default: footageAt dari build.json hf-render-fixture), ukur tekstur area tengah. Exit 1 bila kosong.
//   npx tsx scripts/hf-footage-check.ts <video.mp4> <build.json | t1,t2,...>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { centerTexture } from "../src/lib/video/footageFit";
const [mp4, src] = process.argv.slice(2);
if (!mp4 || !src) { console.error("pakai: hf-footage-check.ts <video.mp4> <build.json|t1,t2>"); process.exit(2); }
const times: number[] = existsSync(src) ? JSON.parse(readFileSync(src, "utf8")).footageAt : src.split(",").map(Number);
const W = 270, H = 480;
let bad = 0;
for (const t of times) {
  const px = new Uint8Array(execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", `scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 16 << 20 }));
  const r = centerTexture(px, W, H);
  if (!r.ok) bad++;
  console.log(`${r.ok ? "ok  " : "EMPTY"} t=${t.toFixed(2)} std=${r.std} edge=${r.edge}`);
}
console.log(bad ? `FOOTAGE_EMPTY ${bad}/${times.length}` : `FOOTAGE_VISIBLE ${times.length}/${times.length}`);
process.exit(bad ? 1 : 0);
