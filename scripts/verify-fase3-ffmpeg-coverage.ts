// Verification gate Fase 3 (P2): satu kebijakan resource utk SEMUA ffmpeg.
// Jalankan dengan: npx --yes tsx scripts/verify-fase3-ffmpeg-coverage.ts
//
// 3 kelompok cek:
// (A) STATIC  - tidak ada direct ffmpeg exec di luar ffmpegExec.ts (semua pola
//               exec/spawn), tidak ada wrapper kedua, semua jalur utility pakai
//               wrapper profil util, parameter kualitas/threshold SAMA PERSIS.
// (B) BEHAVIORAL (mock executor) - klasifikasi error OOM vs timeout, stderr
//               ter-attach ke error (dipakai qualityChecker), semaphore, argumen
//               systemd-run render+util.
// (C) BEHAVIORAL qualityChecker - keputusan QC (warn/hard_reject/passed) identik
//               via runVideoQualityChecks + mock stderr, termasuk perilaku historis
//               "gagal ffmpeg = parse err.stderr, tidak menggagalkan project".

import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  runFfmpeg,
  buildSystemdArgs,
  __setExecFileAsync,
  __resetSemaphore,
} from "@/lib/render/ffmpegExec";
import { runVideoQualityChecks } from "@/lib/pipeline/qualityChecker";

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");

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

function readSrc(relPath: string): string {
  return readFileSync(path.join(SRC_DIR, relPath), "utf8");
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file);
}

type MockExec = Parameters<typeof __setExecFileAsync>[0];

// ============================================================
// (A) STATIC CHECKS
// ============================================================

function testNoDirectFfmpegExecution() {
  const patterns: Array<[string, RegExp]> = [
    ["execFileAsync", /\bexecFileAsync\(\s*["']ffmpeg["']/],
    ["execFile", /\bexecFile\(\s*["']ffmpeg["']/],
    ["spawn", /\bspawn\(\s*["']ffmpeg["']/],
    ["spawnSync", /\bspawnSync\(\s*["']ffmpeg["']/],
    ["exec", /\bexec\(\s*["']ffmpeg["']/],
    ["execSync", /\bexecSync\(\s*["']ffmpeg["']/],
    ["execFileSync", /\bexecFileSync\(\s*["']ffmpeg["']/],
  ];

  const violators: string[] = [];
  for (const file of listTsFiles(SRC_DIR)) {
    // ffmpegExec.ts ADALAH wrapper - satu2nya tempat yang boleh menyebut ffmpeg
    // sbg command (dibungkus systemd-run).
    if (file.endsWith(path.join("render", "ffmpegExec.ts"))) continue;
    const content = readFileSync(file, "utf8");
    for (const [label, re] of patterns) {
      if (re.test(content)) violators.push(`${rel(file)} [${label}]`);
    }
  }
  check(
    "direct ffmpeg execution di luar ffmpegExec.ts = 0",
    violators.length === 0,
    violators.join(", ")
  );
}

function testSinglePolicySystemdRun() {
  // "systemd-run" sbg ARGUMEN PANGGILAN fungsi (bukan sekadar kata di komentar)
  // hanya boleh ada di ffmpegExec.ts - cegah wrapper/kbijakan kedua muncul diam2.
  const callPattern = /\(\s*["']systemd-run["']/;
  const violators: string[] = [];
  for (const file of listTsFiles(SRC_DIR)) {
    if (file.endsWith(path.join("render", "ffmpegExec.ts"))) continue;
    if (callPattern.test(readFileSync(file, "utf8"))) violators.push(rel(file));
  }
  check("pemanggilan systemd-run hanya di ffmpegExec.ts (tidak ada wrapper kedua)", violators.length === 0, violators.join(", "));

  const exec = readSrc("lib/render/ffmpegExec.ts");
  check("ffmpegExec memanggil systemd-run", /\(\s*["']systemd-run["']/.test(exec));
}

function testFfmpegTsIsDelegator() {
  const f = readSrc("lib/render/ffmpeg.ts");
  check(
    "ffmpeg.ts run() murni delegator ke runFfmpeg (render)",
    f.includes('await runFfmpeg(args, "render")')
  );
  check("ffmpeg.ts tidak berisi logika systemd-run sendiri", !/\(\s*["']systemd-run["']/.test(f));
}

function testImageToClipPrivateRunDeleted() {
  const f = readSrc("lib/render/imageToClip.ts");
  check("imageToClip.ts tidak punya private run() lagi", !/async function run\(/.test(f));
  check("imageToClip.ts pakai runFfmpeg", f.includes("runFfmpeg("));
}

function testAllUtilityFilesWrapped() {
  const files: Array<[string, number]> = [
    ["lib/ai/transcribe.ts", 1],
    ["lib/pipeline/qualityChecker.ts", 3],
    ["lib/render/frameExtract.ts", 2],
    ["lib/render/imageToClip.ts", 1],
    ["lib/ai/beatDetect.ts", 1],
    ["lib/ai/dubbing.ts", 1],
  ];
  for (const [file, expectedCalls] of files) {
    const content = readSrc(file);
    const calls = (content.match(/runFfmpeg\(/g) || []).length;
    check(
      `${file}: ${expectedCalls} panggilan runFfmpeg + profil "util"`,
      calls === expectedCalls && content.includes('"util"'),
      `calls=${calls}`
    );
    check(
      `${file}: import dari ffmpegExec`,
      /from\s+["'](@\/lib\/render\/ffmpegExec|\.\.\/render\/ffmpegExec|\.\/ffmpegExec)["']/.test(content)
    );
  }
}

function testQualityCheckerUnchanged() {
  const q = readSrc("lib/pipeline/qualityChecker.ts");
  // Threshold EXACT sama seperti sebelum Fase 3.
  const exactStrings = [
    "const MAX_SILENCE_SECONDS = 8;",
    "const MIN_MEAN_VOLUME_DB = -35;",
    "const MAX_BLACK_SECONDS = 2;",
    "const MAX_SRT_LINE_CHARS = 140;",
    "const SILENCE_WARN_MAX_SECONDS = 12;",
    "const BLACK_WARN_MAX_SECONDS = 4;",
    "const MEAN_VOLUME_WARN_MIN_DB = -30;",
  ];
  for (const s of exactStrings) {
    check(`qualityChecker: ${s.replace("const ", "")}`, q.includes(s));
  }
  // Filter ffmpeg EXACT sama (tidak dilonggarkan/diubah).
  check("qualityChecker: filter silencedetect=noise=-35dB:d= tetap", q.includes("silencedetect=noise=-35dB:d="));
  check("qualityChecker: filter volumedetect tetap", q.includes('"volumedetect"'));
  check("qualityChecker: filter blackdetect=d=1:pic_th=0.98 tetap", q.includes("blackdetect=d=1:pic_th=0.98"));
  // Klasifikasi fixability tetap.
  check(
    "qualityChecker: klasifikasi retry_subtitle_only|warn|hard_reject tetap",
    q.includes('"retry_subtitle_only" | "warn" | "hard_reject"')
  );
  // Pola parse err.stderr saat ffmpeg gagal (perilaku historis) tetap.
  check(
    "qualityChecker: pola parse err.stderr on-failure tetap",
    q.includes(".catch((err) => ({ stderr:")
  );
}

function testEncodeParamsUnchanged() {
  const ic = readSrc("lib/render/imageToClip.ts");
  check(
    "imageToClip: encode libx264 veryfast crf23 yuv420p tetap",
    ic.includes('"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"')
  );
  check("imageToClip: zoompan scale=3840 tetap", ic.includes("scale=3840:-2,"));
  check("imageToClip: output s=1080x1920 tetap", ic.includes("s=1080x1920"));
  check("imageToClip: konstruksi zoompan=z= tetap", ic.includes("zoompan=z='"));

  const f = readSrc("lib/render/ffmpeg.ts");
  check("ffmpeg.ts: CRF 23 tetap", f.includes('"-crf", "23"'));
  check("ffmpeg.ts: preset veryfast tetap", f.includes('"veryfast"'));
  check("ffmpeg.ts: preset ultrafast (step antara) tetap", f.includes('"ultrafast"'));
  check("ffmpeg.ts: loudnorm I=-16:TP=-1.5:LRA=11 tetap", f.includes("loudnorm=I=-16:TP=-1.5:LRA=11"));

  const e = readSrc("lib/render/ffmpegExec.ts");
  check("ffmpegExec: timeout render default 40 menit TIDAK dinaikkan", e.includes("40 * 60 * 1000"));
  check("ffmpegExec: MemorySwapMax ada di kebijakan", e.includes("MemorySwapMax"));
}

function testFfmpegArgsSemanticsPreserved() {
  const t = readSrc("lib/ai/transcribe.ts");
  check(
    "transcribe: args WAV 16kHz mono pcm_s16le tetap",
    t.includes('"-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"')
  );
  const b = readSrc("lib/ai/beatDetect.ts");
  check(
    "beatDetect: args PCM s16le SAMPLE_RATE tetap",
    b.includes('"-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le"')
  );
  const d = readSrc("lib/ai/dubbing.ts");
  check(
    "dubbing: concat demuxer -c copy tetap",
    d.includes('"-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath')
  );
  const fe = readSrc("lib/render/frameExtract.ts");
  check("frameExtract: -vframes 1 -q:v 2 tetap", fe.includes('"-vframes", "1"') && fe.includes('"-q:v", "2"'));
}

function testFfprobeDocumentedException() {
  // ffprobe = binary BERBEDA (baca metadata murni, ~0 memori, bukan encode) -
  // pengecualian terdokumentasi: hanya boleh di 2 file ini.
  const allowed = new Set([path.join("src", "lib", "render", "ffmpeg.ts"), path.join("src", "lib", "ai", "dubbing.ts")]);
  const users: string[] = [];
  for (const file of listTsFiles(SRC_DIR)) {
    if (/\bexecFileAsync\(\s*["']ffprobe["']/.test(readFileSync(file, "utf8"))) {
      users.push(rel(file));
    }
  }
  const unexpected = users.filter((u) => !allowed.has(u));
  check(
    "ffprobe direct = hanya pengecualian terdokumentasi (ffmpeg.ts getDurationSeconds, dubbing.ts durasi audio)",
    unexpected.length === 0 && users.length === 2,
    `users=[${users.join(", ")}] unexpected=[${unexpected.join(", ")}]`
  );
}

// ============================================================
// (B) BEHAVIORAL CHECKS - mock executor
// ============================================================

async function testSystemdArgs() {
  const renderArgs = buildSystemdArgs(["-version"], "render", "kp-v3-render");
  check("render profile: MemoryMax=1000M (default)", renderArgs.includes("MemoryMax=1000M"));
  check("render profile: MemorySwapMax=256M (default)", renderArgs.includes("MemorySwapMax=256M"));
  check("render profile: CPUQuota ada", renderArgs.some((a) => a.startsWith("CPUQuota=")));

  const utilArgs = buildSystemdArgs(["-version"], "util", "kp-v3-util");
  check("util profile: MemoryMax=500M (default)", utilArgs.includes("MemoryMax=500M"));
  check("util profile: MemorySwapMax=64M (default)", utilArgs.includes("MemorySwapMax=64M"));
  check(
    "util profile: ffmpeg setelah --, args utuh",
    utilArgs.includes("ffmpeg") && utilArgs.indexOf("--") < utilArgs.indexOf("ffmpeg") && utilArgs.includes("-version")
  );
}

async function testSemaphoreSerialization() {
  __resetSemaphore(1);
  let active = 0;
  let maxActive = 0;
  const starts: number[] = [];

  __setExecFileAsync((async () => {
    starts.push(Date.now());
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 120));
    active--;
    return { stdout: "", stderr: "" };
  }) as unknown as MockExec);

  await Promise.all([
    runFfmpeg(["-version"], "util").catch(() => {}),
    runFfmpeg(["-version"], "util").catch(() => {}),
  ]);

  check("semaphore global: 2 panggilan paralel tetap serial (maxActive=1)", maxActive === 1, `maxActive=${maxActive}`);
  check("semaphore global: panggilan ke-2 mulai setelah ke-1 selesai", starts.length === 2 && starts[1] - starts[0] >= 80, `gap=${starts[1] - starts[0]}ms`);
  __setExecFileAsync(null);
}

async function testErrorClassification() {
  // (1) SIGKILL + unit Result=oom-kill -> pesan OOM.
  __resetSemaphore(1);
  __setExecFileAsync((async (cmd: string, args: readonly string[]) => {
    if (cmd === "systemctl" && args.includes("show")) {
      return { stdout: "Result=oom-kill\nExecMainStatus=137\n", stderr: "" };
    }
    if (cmd === "systemctl" && args.includes("stop")) {
      return { stdout: "", stderr: "" };
    }
    const err = new Error("killed") as Error & { killed?: boolean; signal?: string; stderr?: string };
    err.killed = true;
    err.signal = "SIGKILL";
    err.stderr = "frame= 100 fps=25 q=0.0 size=     256kB";
    throw err;
  }) as unknown as MockExec);

  let caught: unknown;
  try {
    await runFfmpeg(["-version"], "util");
  } catch (e) {
    caught = e;
  }
  check(
    "klasifikasi error: OOM-kill dibedakan dari timeout",
    caught instanceof Error && caught.message.includes("melebihi batas memory (OOM)"),
    caught instanceof Error ? caught.message : String(caught)
  );

  // (2) SIGKILL + Result=success -> pesan timeout (bukan OOM).
  __setExecFileAsync((async (cmd: string, args: readonly string[]) => {
    if (cmd === "systemctl" && args.includes("show")) {
      return { stdout: "Result=success\n", stderr: "" };
    }
    if (cmd === "systemctl" && args.includes("stop")) {
      return { stdout: "", stderr: "" };
    }
    const err = new Error("killed") as Error & { killed?: boolean; signal?: string; stderr?: string };
    err.killed = true;
    err.signal = "SIGKILL";
    err.stderr = "frame= 999 fps=0.0";
    throw err;
  }) as unknown as MockExec);

  caught = undefined;
  try {
    await runFfmpeg(["-version"], "util");
  } catch (e) {
    caught = e;
  }
  check(
    "klasifikasi error: timeout (bukan OOM) tetap terdeteksi",
    caught instanceof Error && caught.message.includes("melebihi batas waktu"),
    caught instanceof Error ? caught.message : String(caught)
  );
  __setExecFileAsync(null);
}

async function testStderrAttachedToFailure() {
  __resetSemaphore(1);
  __setExecFileAsync((async () => {
    const err = new Error("Command failed: systemd-run") as Error & { stderr?: string };
    err.stderr = "MARKER_STDERR_TAIL_XYZ";
    throw err;
  }) as unknown as MockExec);

  let caught: unknown;
  try {
    await runFfmpeg(["-badflag"], "util");
  } catch (e) {
    caught = e;
  }
  check(
    "stderr ter-attach sbg property .stderr (dipakai qualityChecker on-failure)",
    caught instanceof Error && (caught as { stderr?: string }).stderr === "MARKER_STDERR_TAIL_XYZ"
  );
  check(
    "message error memuat tail stderr",
    caught instanceof Error && caught.message.includes("MARKER_STDERR_TAIL_XYZ")
  );
  check(
    "message error diawali 'ffmpeg gagal:'",
    caught instanceof Error && caught.message.startsWith("ffmpeg gagal:")
  );
  __setExecFileAsync(null);
}

// ============================================================
// (C) BEHAVIORAL CHECKS - keputusan qualityChecker identik
// ============================================================

function mkStderrMock(handler: (joinedArgs: string) => { stdout: string; stderr: string } | never): MockExec {
  return (async (cmd: string, args: readonly string[]) => {
    if (cmd === "systemctl") return { stdout: "Result=success\n", stderr: "" };
    const joined = args.join(" ");
    return handler(joined);
  }) as unknown as MockExec;
}

async function testQcDecisionsFromMockStderr() {
  __resetSemaphore(1);
  // Skenario A: nilai dari stderr SUKSES - 9.5dtk sunyi (warn), -38.5dB (hard), 3.0dtk hitam (warn).
  __setExecFileAsync(
    mkStderrMock((joined) => {
      if (joined.includes("silencedetect")) {
        return { stdout: "", stderr: "[silencedetect] silence_start: 1.0\nsilence_duration: 9.5\nsilence_end: 10.5\n" };
      }
      if (joined.includes("volumedetect")) {
        return { stdout: "", stderr: "[Parsed_volumedetect] mean_volume: -38.5 dB\nmax_volume: -12.0 dB\n" };
      }
      if (joined.includes("blackdetect")) {
        return { stdout: "", stderr: "[blackdetect] black_start: 2.0\nblack_end: 5.0\nblack_duration: 3.0\n" };
      }
      return { stdout: "", stderr: "" };
    })
  );

  const a = await runVideoQualityChecks("http://mock/v.mp4", 30, 20);
  const silenceA = a.structured.find((i) => i.code === "silence");
  check("QC A: sunyi 9.5dtk -> warn (borderline)", silenceA?.fixability === "warn", JSON.stringify(a.structured));
  check("QC A: pesan sunyi menyebut durasi", !!silenceA && /jeda sunyi \d+ detik/.test(silenceA.message));
  const volA = a.structured.find((i) => i.code === "mean_volume");
  check("QC A: volume -38.5dB -> hard_reject", volA?.fixability === "hard_reject");
  check("QC A: pesan volume menyebut -38.5dB", !!volA && volA.message.includes("-38.5dB"));
  const blackA = a.structured.find((i) => i.code === "black_frames");
  check("QC A: hitam 3.0dtk -> warn (borderline)", blackA?.fixability === "warn");
  check("QC A: hard_reject ada -> passed=false", a.passed === false);
  check("QC A: durasi 30>=20 -> tidak ada issue duration_short", !a.structured.some((i) => i.code === "duration_short"));

  // Skenario B: ffmpeg GAGAL (non-zero exit) dgn stderr parsial - perilaku historis
  // "parse err.stderr, gagal cek TIDAK menggagalkan project" harus tetap.
  __setExecFileAsync(
    (async (cmd: string, args: readonly string[]) => {
      if (cmd === "systemctl") return { stdout: "Result=success\n", stderr: "" };
      const joined = args.join(" ");
      if (joined.includes("silencedetect")) {
        const err = new Error("exit 1") as Error & { stderr?: string };
        err.stderr = "[silencedetect] silence_duration: 9.5\n";
        throw err;
      }
      return { stdout: "", stderr: "" }; // volume/hitam: tidak ada data
    }) as unknown as MockExec
  );

  const b = await runVideoQualityChecks("http://mock/v.mp4", 30, 20);
  const silenceB = b.structured.find((i) => i.code === "silence");
  check("QC B: kegagalan ffmpeg TIDAK menelan data - sunyi 9.5 dari err.stderr tetap terdeteksi (warn)", silenceB?.fixability === "warn", JSON.stringify(b.structured));
  check("QC B: volume null -> tidak ada issue volume", !b.structured.some((i) => i.code === "mean_volume"));
  check("QC B: hitam 0 -> tidak ada issue hitam", !b.structured.some((i) => i.code === "black_frames"));
  check("QC B: hanya warn -> passed=true (gagal cek tidak menggagalkan project)", b.passed === true);

  // Skenario C: durasi pendek tanpa data ffmpeg apa pun -> duration_short hard_reject.
  __setExecFileAsync(mkStderrMock(() => ({ stdout: "", stderr: "" })));
  const c = await runVideoQualityChecks("http://mock/v.mp4", 10, 20);
  const durC = c.structured.find((i) => i.code === "duration_short");
  check("QC C: durasi 10<20 -> duration_short hard_reject", durC?.fixability === "hard_reject");
  check("QC C: passed=false", c.passed === false);

  __setExecFileAsync(null);
}

async function testRunFfmpegReturnsStderr() {
  __resetSemaphore(1);
  __setExecFileAsync((async () => ({ stdout: "OUT123", stderr: "ERR456" })) as unknown as MockExec);
  const r = await runFfmpeg(["-version"], "util");
  check("runFfmpeg sukses mengembalikan {stdout, stderr} (utk parse QC)", r.stdout === "OUT123" && r.stderr === "ERR456");
  __setExecFileAsync(null);
}

// ============================================================

async function main() {
  console.log("Running Fase 3 verification gate: satu kebijakan resource utk semua ffmpeg\n");

  console.log("--- (A) Static checks ---");
  testNoDirectFfmpegExecution();
  testSinglePolicySystemdRun();
  testFfmpegTsIsDelegator();
  testImageToClipPrivateRunDeleted();
  testAllUtilityFilesWrapped();
  testQualityCheckerUnchanged();
  testEncodeParamsUnchanged();
  testFfmpegArgsSemanticsPreserved();
  testFfprobeDocumentedException();

  console.log("\n--- (B) Behavioral checks (mock executor) ---");
  await testSystemdArgs();
  await testSemaphoreSerialization();
  await testErrorClassification();
  await testStderrAttachedToFailure();
  await testRunFfmpegReturnsStderr();

  console.log("\n--- (C) QualityChecker decision checks ---");
  await testQcDecisionsFromMockStderr();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
