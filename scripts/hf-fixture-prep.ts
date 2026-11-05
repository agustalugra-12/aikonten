// Siapkan proyek render uji VideoPlan dari fixture lokal (revisi 2026-11-05). HANYA di VPS Agustap / worker.
//   npx tsx scripts/hf-fixture-prep.ts <fxDir> <domain> <plan.json> <projDir> <baseDir>
// fxDir/<domain>/{final.mp4,sub.srt,clipN.mp4} + fxDir/meta.json (subjek footage dari footage_bank/Pexels).
// Analisis frame (ketajaman + letak subjek) memakai analyzeClip produksi (ffmpeg, gratis).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeClip } from "../src/lib/video/footageFit";
import type { PlanMedia } from "../src/lib/video/planBuilder";

const [fx, d, planPath, P, base] = process.argv.slice(2);
const CUT: Record<string, number> = { hospitality: 12.52, laundry: 13.46, animal: 14.97 }; // akhir kalimat VO yg dipakai
const MARK: Record<string, string> = { hospitality: "PELANGI HOMESTAY", laundry: "LAUNDRY IN BALI", animal: "ANIMAL STORY" };
const GLOSSARY: Record<string, string[]> = { hospitality: ["Bedugul", "Nasi Tempong", "Mentari"], laundry: ["Denpasar"], animal: ["Galapagos"] };
const FONT: Record<string, string> = { poppins: "Poppins", archivoblack: "Archivo Black" };
type Meta = { brand: string; brand_kit: Record<string, string>; clips: Array<{ file: string; subject: { description: string; tags: string[] } }> };

(async () => {
  const meta = (JSON.parse(readFileSync(join(fx, "meta.json"), "utf8")) as Record<string, Meta>)[d];
  mkdirSync(join(P, "media"), { recursive: true });
  cpSync(base, P, { recursive: true });
  const end = CUT[d] + 0.3;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(fx, d, "final.mp4"), "-t", end.toFixed(2), "-vn", "-af", `afade=t=out:st=${(end - 0.3).toFixed(2)}:d=0.3`, "-ac", "2", "-ar", "44100", "-b:a", "160k", join(P, "media/vo.mp3")]);
  const footage: PlanMedia["footage"] = {};
  for (const [i, c] of meta.clips.entries()) {
    const src = join(fx, d, c.file);
    cpSync(src, join(P, "media", `c${i}.mp4`));
    const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { encoding: "utf8" }));
    const [sw, sh] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height:stream_side_data=rotation", "-of", "json", src], { encoding: "utf8" }).match(/"width": (\d+),\s*"height": (\d+)/)!.slice(1).map(Number);
    const rot = /"rotation": -?90/.test(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream_side_data=rotation", "-of", "json", src], { encoding: "utf8" }));
    const analysis = await analyzeClip(src, dur, { probe: rot ? { w: sh, h: sw } : { w: sw, h: sh } });
    // source=vision bila ADA metadata isi (deskripsi/judul/tags = apa yg dikembalikan), bukan sekadar kata pencarian.
    const hasContent = !!(c.subject.description && c.subject.description.trim()) || !!(c.subject.tags && c.subject.tags.length);
    footage[`c${i}`] = { videoUrl: `./media/c${i}.mp4`, durationSeconds: Math.round(dur * 1000) / 1000, mediaStart: 0, subject: { ...c.subject, source: hasContent ? "vision" : "query" }, analysis };
    console.error(d, `c${i}`, JSON.stringify(analysis), c.subject.description.slice(0, 50));
  }
  // Kata dari SRT: dibagi rata per cue sesuai panjang kata (SRT produksi tak punya timing per kata).
  const words: PlanMedia["words"] = [];
  const t = readFileSync(join(fx, d, "sub.srt"), "utf8");
  for (const m of t.matchAll(/(\d\d):(\d\d):(\d\d),(\d+) --> (\d\d):(\d\d):(\d\d),(\d+)\n([\s\S]*?)(?:\n\n|$)/g)) {
    const a = +m[2] * 60 + +m[3] + +m[4] / 1000, b = +m[6] * 60 + +m[7] + +m[8] / 1000;
    if (a >= end) break;
    const ws = m[9].split(/\s+/).filter(Boolean), tot = ws.reduce((s, w) => s + w.length + 1, 0);
    let x = a;
    for (const w of ws) { const dw = ((b - a) * (w.length + 1)) / tot; words.push({ word: w, start: +x.toFixed(3), end: +(x + dw * 0.9).toFixed(3) }); x += dw; }
  }
  const k = meta.brand_kit;
  const media: PlanMedia = {
    footage, audioUrl: "./media/vo.mp3", audioDurationSeconds: +end.toFixed(3), words, musicUrl: null,
    brand: { primary: k.primaryColor, accent: k.highlightColor, cta: k.ctaColor, font: FONT[k.subtitleFont || "poppins"] ?? "Poppins", mark: MARK[d], name: meta.brand },
    brandLook: k.look ?? null, emphasisPhrases: [], seed: `render-${d}`, beatSeconds: null, sfxBase: "./sfx", glossary: GLOSSARY[d],
  };
  writeFileSync(join(P, "input.json"), JSON.stringify({ plan: JSON.parse(readFileSync(planPath, "utf8")), media }, null, 1));
  console.log(`${d}: ${Object.keys(footage).length} klip, ${words.length} kata, VO ${end.toFixed(2)}s`);
})().catch((e) => { console.error(e); process.exit(1); });
