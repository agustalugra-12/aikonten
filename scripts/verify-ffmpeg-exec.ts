/* eslint-disable no-console */
// Verification gate Fase 1: ffmpegExec — semaphore, systemd args, resource preflight.
// Jalankan dengan: npx --yes tsx scripts/verify-ffmpeg-exec.ts

import {
  buildSystemdArgs,
  parseMeminfo,
  assertResourcesAvailable,
  checkMemoryAvailable,
  runFfmpeg,
  __setExecFileAsync,
  __resetSemaphore,
  ResourceInsufficientError,
  FfmpegQueueError,
} from "../src/lib/render/ffmpegExec";

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

async function testBuildArgs() {
  const args = buildSystemdArgs(["-version"], "render", "kp-test-1");
  check("args include --wait", args.includes("--wait"));
  check("args include --pipe", args.includes("--pipe"));
  check("args include --unit kp-test-1", args.includes("--unit") && args[args.indexOf("--unit") + 1] === "kp-test-1");
  check("args include MemoryMax", args.some((a) => a.startsWith("MemoryMax=")));
  check("args include MemorySwapMax=256M", args.includes("MemorySwapMax=256M"));
  check("args include CPUQuota", args.some((a) => a.startsWith("CPUQuota=")));
  check("args place ffmpeg after --", args.includes("ffmpeg") && args.indexOf("--") < args.indexOf("ffmpeg"));
}

async function testUtilProfile() {
  process.env.FFMPEG_UTIL_MEMORY_MAX = "400M";
  process.env.FFMPEG_UTIL_SWAP_MAX = "32M";
  const args = buildSystemdArgs(["-version"], "util", "kp-test-util");
  check("util profile uses env MemoryMax", args.includes("MemoryMax=400M"));
  check("util profile swap cap", args.includes("MemorySwapMax=32M"));
  delete process.env.FFMPEG_UTIL_MEMORY_MAX;
  delete process.env.FFMPEG_UTIL_SWAP_MAX;
}

async function testResourcePreflight() {
  const good = parseMeminfo(
    "MemTotal:       4000000 kB\nMemAvailable:    1200000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n"
  );
  let threw = false;
  try {
    assertResourcesAvailable(good, 500);
  } catch {
    threw = true;
  }
  check("preflight passes when resources ample", !threw);

  const lowMem = parseMeminfo(
    "MemTotal:       4000000 kB\nMemAvailable:     400000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n"
  );
  try {
    assertResourcesAvailable(lowMem, 500);
    threw = false;
  } catch (e) {
    threw = true;
    check("preflight throws ResourceInsufficientError on low memory", e instanceof ResourceInsufficientError);
  }
  check("preflight rejects low memory", threw);

  const lowSwap = parseMeminfo(
    "MemTotal:       4000000 kB\nMemAvailable:    1200000 kB\nSwapTotal:       2000000 kB\nSwapFree:         100000 kB\n"
  );
  try {
    assertResourcesAvailable(lowSwap, 500);
    threw = false;
  } catch (e) {
    threw = true;
    check("preflight throws ResourceInsufficientError on low swap", e instanceof ResourceInsufficientError);
  }
  check("preflight rejects low swap", threw);
}

async function testSemaphoreSerialization() {
  __resetSemaphore(1);
  const starts: number[] = [];
  let active = 0;
  let maxActive = 0;

  __setExecFileAsync((async () => {
    starts.push(Date.now());
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 120));
    active--;
    return { stdout: "", stderr: "" };
  }) as unknown as Parameters<typeof __setExecFileAsync>[0]);

  await Promise.all([
    runFfmpeg(["-version"], "util").catch(() => {}),
    runFfmpeg(["-version"], "util").catch(() => {}),
  ]);

  check("semaphore serialized 2 concurrent calls", maxActive === 1, `maxActive=${maxActive}`);
  const gap = starts[1] - starts[0];
  check("second call started after first finished", gap >= 80, `gap=${gap}ms`);
  __setExecFileAsync(null);
}

async function testQueueTimeout() {
  __resetSemaphore(1);
  process.env.FFMPEG_QUEUE_WAIT_MS = "100";

  let resolveOccupied: (() => void) | undefined;
  const occupied = new Promise<void>((r) => {
    resolveOccupied = r;
  });

  __setExecFileAsync((async () => {
    if (resolveOccupied) resolveOccupied();
    await new Promise((_resolve) => {
      // never resolve; occupying the single permit
    });
    return { stdout: "", stderr: "" };
  }) as unknown as Parameters<typeof __setExecFileAsync>[0]);

  const first = runFfmpeg(["-version"], "util").catch(() => "occupied");
  await occupied; // first call is now inside executor and holds the permit

  const t0 = Date.now();
  const second = runFfmpeg(["-version"], "util").catch((e) => e);
  const result = await second;
  const elapsed = Date.now() - t0;
  void first; // never resolves by design

  check("queued call rejected with FfmpegQueueError", result instanceof FfmpegQueueError);
  check("queue timeout respected (~100ms)", elapsed < 500, `elapsed=${elapsed}ms`);

  delete process.env.FFMPEG_QUEUE_WAIT_MS;
  __setExecFileAsync(null);
}

async function testRealMemoryCheck() {
  try {
    // checkMemoryAvailable reads the real /proc/meminfo; proves preflight wiring
    // works without requiring a real systemd-run invocation in the test environment.
    await checkMemoryAvailable();
    check("real /proc/meminfo preflight passes", true);
  } catch (e) {
    check("real /proc/meminfo preflight passes", false, String(e));
  }
}

async function main() {
  console.log("Running Fase 1 verification gate: ffmpegExec\n");
  await testBuildArgs();
  await testUtilProfile();
  await testResourcePreflight();
  await testSemaphoreSerialization();
  await testQueueTimeout();
  await testRealMemoryCheck();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
