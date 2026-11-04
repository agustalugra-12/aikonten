// Scene-sequence render engine (HyperFrames Pro P3→pipeline, 2026-11-02). renderEngine="scenes":
// petakan field konten AI (hookText/statOverlays/ctaText/caption) -> urutan scene desain bold-poster
// -> render tiap scene di worker -> ffmpeg concat (xfade) + musik -> R2. MUSIK-ONLY (tanpa voiceover;
// frame desain bawa pesan visual). Return {videoUrl,durationSeconds} sama bentuk renderFinalVideo.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBoldCover, buildBoldStat, buildBoldClosing, buildBoldFootage } from "./scenes/boldPoster";
import { renderComposition } from "./hyperframesClient";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

type Orient = "portrait" | "landscape" | "square";

export type ScenesRenderOpts = {
  projectId: string;
  brandId: string;
  orientation?: Orient;
  brandName?: string | null;
  hookText?: string | null;
  caption?: string | null;
  statOverlays?: Array<{ label: string; value: string }>;
  cta?: string | null;
  musicUrl?: string | null;
  brollClips?: Array<{ videoUrl: string; durationSeconds: number }>; // footage brand utk hybrid
  captions?: string[]; // frasa caption footage-scene (dari emphasisPhrases)
  onQueueEvent?: (step: string, action: string, result: string) => void; // Gerbang 2: log antre/render (flag-gated)
};

const XFADE = 0.4;
// #3 (2026-11-03): variasi transisi antar-scene (dulu selalu "fade" polos -> monoton).
// ffmpeg xfade: slide/zoom/wipe + fade, cycle per batas scene biar terasa "diedit" (senada P4
// engine hyperframes). Semua nama valid xfade (lihat ffmpeg -h filter=xfade).
const SCENE_TRANSITIONS = ["slideleft", "zoomin", "wiperight", "fade"];

function firstSentences(text: string | null | undefined, n: number): string {
  const s = String(text || "").split(/(?<=[.!?])\s+/).filter(Boolean);
  return s.slice(0, n).join(" ");
}

// Cover title PENDEK-PUNCHY (fix 2026-11-03): hookText sering 1 kalimat panjang -> judul
// Cover wrap 6 baris & kepotong (buildBoldCover font tetap, belum auto-fit). Ambil klausa
// pertama (potong di tanda baca kuat), cap <=8 kata, buang kata-sambung di ujung (EN+ID)
// biar tak ngegantung ("...cat that", "...yang"). Hook yg sudah pendek lewat apa adanya.
const HOOK_STOP = new Set(["the", "a", "an", "of", "to", "and", "or", "that", "with", "for", "in", "on", "at", "is", "are", "was", "were", "as", "their", "its", "your", "not", "just", "how", "what", "dan", "dengan", "yang", "untuk", "di", "ke", "dari", "pada", "atau", "ini", "itu", "yg", "adalah", "akan"]);
function coverTitle(raw: string): string {
  const full = String(raw || "").trim();
  const clause = (full.match(/^[^.!?—:;,]+/)?.[0] || full).trim();
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 8);
  while (words.length > 2 && HOOK_STOP.has(words[words.length - 1].toLowerCase().replace(/[^a-z']/g, ""))) words.pop();
  return words.join(" ") || full;
}

// Self-check (ponytail): jalankan manual `tsx -e` kalau ragu.
export function _coverTitleDemo(): void {
  const long = coverTitle("Success Discover the incredible hunting strategies of Smilodon, the iconic saber-toothed cat that ruled");
  if (long !== "Success Discover the incredible hunting strategies of Smilodon") throw new Error("clause+cap gagal: " + long);
  if (coverTitle("Kamar sejuk tanpa AC?") !== "Kamar sejuk tanpa AC") throw new Error("hook pendek harus lewat");
  if (coverTitle("Promo kamar untuk") !== "Promo kamar") throw new Error("buang stopword ujung gagal");
}

// Petakan konten -> daftar scene {html, dur}. Selalu Cover + Closing; Stat kalau ada angka.
function buildScenePlan(opts: ScenesRenderOpts): Array<{ html: string; dur: number }> {
  const orientation = opts.orientation || "portrait";
  const mark = (opts.brandName || "").toUpperCase();
  const broll = opts.brollClips || [];
  const caps = opts.captions || [];
  const scenes: Array<{ html: string; dur: number }> = [];

  // Footage-scene ke-i (hybrid): klip brand + caption. null kalau tak ada footage.
  const footage = (i: number): { html: string; dur: number } | null =>
    broll[i] && broll[i].videoUrl
      ? { dur: 3.5, html: buildBoldFootage({ orientation, videoUrl: broll[i].videoUrl, durationSeconds: 3.5, caption: (caps[i] || "").slice(0, 60), mark }) }
      : null;

  scenes.push({
    dur: 4,
    html: buildBoldCover({
      orientation,
      title: coverTitle(opts.hookText || firstSentences(opts.caption, 1) || opts.brandName || "Konten"),
      eyebrow: mark,
      tagline: firstSentences(opts.caption, 1).slice(0, 140),
      mark,
      durationSeconds: 4,
    }),
  });

  const f0 = footage(0);
  if (f0) scenes.push(f0);

  const stat = opts.statOverlays && opts.statOverlays[0];
  if (stat && (stat.value || "").trim()) {
    scenes.push({
      dur: 3,
      html: buildBoldStat({ orientation, value: stat.value, label: (stat.label || "").toUpperCase(), sub: "", mark, durationSeconds: 3 }),
    });
  }

  const f1 = footage(1);
  if (f1) scenes.push(f1);

  scenes.push({
    dur: 3.5,
    html: buildBoldClosing({
      orientation,
      title: opts.cta || "Pesan sekarang juga",
      cta: "Link WA di bio",
      mark,
      durationSeconds: 3.5,
    }),
  });

  return scenes;
}

// Jalankan ffmpeg (spawn langsung, BUKAN systemd-run wrapper) -> reject kalau gagal.
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`))));
  });
}

// Bangun filter xfade berantai utk N klip (durasi sama urut) + mixing musik.
function buildXfadeFilter(durs: number[], hasMusic: boolean, total: number): { filter: string; vlabel: string; alabel: string | null } {
  const parts: string[] = [];
  for (let i = 0; i < durs.length; i++) parts.push(`[${i}:v]format=yuv420p,settb=AVTB,fps=30[v${i}]`);
  let prev = "v0", acc = durs[0];
  for (let i = 1; i < durs.length; i++) {
    const out = i === durs.length - 1 ? "vout" : `x${i}`;
    const offset = (acc - XFADE).toFixed(3);
    const trans = SCENE_TRANSITIONS[(i - 1) % SCENE_TRANSITIONS.length];
    parts.push(`[${prev}][v${i}]xfade=transition=${trans}:duration=${XFADE}:offset=${offset}[${out}]`);
    prev = out;
    acc = acc + durs[i] - XFADE;
  }
  const vlabel = durs.length === 1 ? "v0" : "vout";
  let alabel: string | null = null;
  if (hasMusic) {
    const mi = durs.length; // music input index
    const fo = Math.max(0, total - 1).toFixed(2);
    parts.push(`[${mi}:a]atrim=0:${total.toFixed(2)},afade=t=out:st=${fo}:d=1,volume=0.4[aud]`);
    alabel = "aud";
  }
  return { filter: parts.join(";"), vlabel, alabel };
}

export async function renderViaScenes(opts: ScenesRenderOpts): Promise<{ videoUrl: string; durationSeconds: number }> {
  const scenes = buildScenePlan(opts);
  const dir = await mkdtemp(join(tmpdir(), "kp-scenes-"));
  try {
    // 1. Render tiap scene di worker -> file lokal.
    const files: string[] = [];
    const durs: number[] = [];
    for (let i = 0; i < scenes.length; i++) {
      // Gerbang 2 (req2): tiap scene lewat ANTREAN yg sama (brand+project+contentHash PER ADEGAN) -> satu
      // video scenes (N render) ikut fair-scheduler per tenant, tak memonopoli worker tanpa batas.
      // Flag off -> renderComposition abaikan queueOpts (jalur lama, IDENTIK).
      const buf = await renderComposition(
        scenes[i].html,
        { id: `${opts.projectId}-s${i}`, name: `scene${i}` },
        undefined,
        { tenantId: opts.brandId, projectId: `${opts.projectId}-s${i}`, contentHash: createHash("sha256").update(scenes[i].html).digest("hex").slice(0, 16), log: opts.onQueueEvent },
      );
      const f = join(dir, `s${i}.mp4`);
      await writeFile(f, buf);
      files.push(f);
      durs.push(scenes[i].dur);
    }
    // total setelah xfade overlap
    const total = durs.reduce((a, b) => a + b, 0) - XFADE * (durs.length - 1);

    // 2. ffmpeg concat (xfade) + musik.
    const hasMusic = !!opts.musicUrl;
    const { filter, vlabel, alabel } = buildXfadeFilter(durs, hasMusic, total);
    const out = join(dir, "seq.mp4");
    const args: string[] = [];
    for (const f of files) args.push("-i", f);
    if (hasMusic) args.push("-i", opts.musicUrl!);
    args.push("-filter_complex", filter, "-map", `[${vlabel}]`);
    if (alabel) args.push("-map", `[${alabel}]`);
    args.push("-t", total.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
    if (alabel) args.push("-c:a", "aac", "-shortest");
    args.push("-y", out);
    await runFfmpeg(args);

    // 3. Upload R2.
    const mp4 = await readFile(out);
    const videoUrl = await uploadBuffer(buildAssetKey(opts.brandId, opts.projectId, "final.mp4"), mp4, "video/mp4");
    return { videoUrl, durationSeconds: Math.round(total) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
