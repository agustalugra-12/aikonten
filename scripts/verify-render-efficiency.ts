/* eslint-disable no-console */
// Verification gate (2026-11-06): render-efficiency.
//  (a) video gelap (bertema malam/bawah laut, punya highlight) TIDAK ditolak,
//  (b) video hitam sungguhan (klip rusak/gagal muat) TETAP ditolak,
//  (c) loop generate berhenti pada batas waktu + per-video timeout melempar,
//  (d) hasil gabungan klip (tree) tetap sama dgn rencana sequential.
// Jalankan: npx --yes tsx scripts/verify-render-efficiency.ts
// Butuh ffmpeg (klip uji kecil via lavfi, niced - aman jalan berdampingan generate).

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { computeTrueBlackSeconds } from "../src/lib/pipeline/qualityChecker";
import { makeDeadline, withTimeout, StageTimeoutError } from "../src/lib/cron/renderBudget";
import { planTreeMerge, computeClipSequencePlan } from "../src/lib/render/transitions";

const execFileAsync = promisify(execFile);
let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NICE = ["-n", "19", "ionice", "-c3", "ffmpeg", "-hide_banner"];

// Jalankan combined-pass blackdetect+signalstats (SAMA spt probeVideo) -> stderr utk diparse.
async function probeStderr(path: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync(
      "nice",
      [...NICE, "-i", path, "-vf", "blackdetect=d=1:pic_th=0.98,signalstats,metadata=print:key=lavfi.signalstats.YMAX", "-an", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 64 },
    );
    return stderr;
  } catch (e) {
    return (e as { stderr?: string }).stderr || "";
  }
}

async function makeClip(out: string, extraVf: string | null): Promise<void> {
  // bg sangat gelap (0x080808, ~3/255) 5dtk; extraVf opsional menambah highlight.
  const args = ["-n", "19", "ionice", "-c3", "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x080808:s=320x240:d=5:r=30"];
  if (extraVf) args.push("-vf", extraVf);
  args.push("-t", "5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out, "-y");
  await execFileAsync("nice", args);
}

async function testBlackDetect(dir: string) {
  // (b) HITAM SUNGGUHAN: pure black (klip gagal dimuat/corrupt menghasilkan ini).
  const black = join(dir, "black.mp4");
  await execFileAsync("nice", ["-n", "19", "ionice", "-c3", "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=5:r=30", "-t", "5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", black, "-y"]);
  const blackErr = await probeStderr(black);
  const blackTrue = computeTrueBlackSeconds(blackErr);
  check("(b) klip hitam memicu blackdetect (kandidat)", /black_duration/.test(blackErr));
  check("(b) klip hitam SUNGGUHAN terdeteksi >4dtk -> tetap ditolak", blackTrue > 4, `trueBlack=${blackTrue.toFixed(2)}s`);

  // (a) ADEGAN GELAP disengaja + highlight (bulan/pantulan = kotak putih kecil).
  const dark = join(dir, "dark.mp4");
  await makeClip(dark, "drawbox=x=150:y=100:w=18:h=18:color=white:t=fill");
  const darkErr = await probeStderr(dark);
  const darkTrue = computeTrueBlackSeconds(darkErr);
  // Bukti akar bug: blackdetect LAMA tetap menandai adegan gelap ini (98% piksel gelap)...
  check("(a) adegan gelap TETAP memicu blackdetect lama (bukti false-positive)", /black_duration/.test(darkErr));
  // ...tapi logika baru (YMAX) TIDAK menghitungnya hitam sungguhan -> lolos (tak dibuang).
  check("(a) adegan gelap TIDAK dihitung hitam sungguhan (<1dtk) -> LOLOS", darkTrue < 1, `trueBlack=${darkTrue.toFixed(2)}s`);
}

async function testBudget() {
  // (c) deadline per-putaran berhenti tepat pada batas (clock palsu).
  let t = 0;
  const clock = () => t;
  const deadline = makeDeadline(5000, clock);
  check("(c) deadline belum lewat saat elapsed 0", deadline() === false);
  t = 4999;
  check("(c) deadline belum lewat tepat di bawah batas", deadline() === false);
  t = 5000;
  check("(c) deadline lewat saat elapsed == budget", deadline() === true);

  // loop 10 ide, +2000ms/ide, budget 5000ms -> berhenti setelah ~3 (bukan 10).
  t = 0;
  const d2 = makeDeadline(5000, () => t);
  let done = 0;
  for (let i = 0; i < 10; i++) {
    if (d2()) break;
    t += 2000;
    done++;
  }
  check("(c) loop berhenti ~3 ide saat budget habis (bukan 10)", done === 3, `done=${done}`);

  // (c) per-video timeout: kerja cepat lolos, render nyangkut -> StageTimeoutError.
  const ok = await withTimeout(Promise.resolve("x"), 1000, "cepat");
  check("(c) withTimeout loloskan kerja cepat", ok === "x");
  let threw = false;
  await withTimeout(new Promise((r) => setTimeout(r, 300)), 20, "lambat").catch((e) => { threw = e instanceof StageTimeoutError; });
  check("(c) withTimeout lempar StageTimeoutError utk render nyangkut", threw);
}

function testMergeInvariant() {
  // (d) tree-merge (eksekusi) HARUS menghasilkan durasi total == rencana sequential
  // (metadata) utk sembarang susunan klip - jaminan "hasil gabungan tetap sama".
  const cases: number[][] = [
    [5],
    [3, 4],
    [2, 2, 2],
    [1.0, 1.0, 1.0], // klip pendek <1.5dtk -> boundary = concat (tanpa transisi)
    [3, 3, 3, 3, 3],
    [2.5, 4, 1.2, 6, 3, 3, 2, 5],
    Array.from({ length: 34 }, (_, i) => 3 + (i % 5) * 0.5), // long-form ~34 klip
  ];
  for (const durs of cases) {
    const seq = computeClipSequencePlan(durs, []);
    const steps = planTreeMerge(durs, []);
    const root = steps.length ? steps[steps.length - 1].resultDurationSeconds : durs[0];
    const diff = Math.abs(root - seq.totalDurationSeconds);
    check(`(d) tree==sequential durasi utk ${durs.length} klip`, diff < 1e-6, `tree=${root.toFixed(3)} seq=${seq.totalDurationSeconds.toFixed(3)}`);
  }
}

async function main() {
  console.log("Running render-efficiency verification gate\n");
  const dir = await mkdtemp(join(tmpdir(), "kp-reff-"));
  try {
    await testBlackDetect(dir);
    await testBudget();
    testMergeInvariant();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
