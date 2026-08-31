// Eksekusi FFmpeg terpusat dg kebijakan resource + semaphore global (2026-08-31,
// Fase 1 post-OOM audit). SEMUA pemanggilan ffmpeg di codebase wajib lewat sini
// supaya tidak ada jalur yang bypass cgroup/timeout/swap-cap.

import { execFile, ExecFileOptions } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";

const execFileAsync = promisify(execFile);

export type FfmpegProfile = "render" | "util";

export class FfmpegQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegQueueError";
  }
}

export class ResourceInsufficientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceInsufficientError";
  }
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envString(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function getProfileConfig(profile: FfmpegProfile) {
  if (profile === "util") {
    return {
      timeoutMs: envInt("FFMPEG_UTIL_TIMEOUT_MS", 5 * 60 * 1000),
      memoryMax: envString("FFMPEG_UTIL_MEMORY_MAX", "500M"),
      swapMax: envString("FFMPEG_UTIL_SWAP_MAX", "64M"),
      cpuQuota: envString("FFMPEG_UTIL_CPU_QUOTA", "150%"),
    };
  }
  return {
    timeoutMs: envInt("FFMPEG_TIMEOUT_MS", 40 * 60 * 1000),
    memoryMax: envString("FFMPEG_MEMORY_MAX", "1000M"),
    swapMax: envString("FFMPEG_SWAP_MAX", "256M"),
    cpuQuota: envString("FFMPEG_CPU_QUOTA", "150%"),
  };
}

class Semaphore {
  private permits: number;
  private queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer?: NodeJS.Timeout;
  }> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(deadlineMs: number): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }
    return new Promise((resolve, reject) => {
      const node: {
        resolve: (release: () => void) => void;
        reject: (err: Error) => void;
        timer?: NodeJS.Timeout;
      } = { resolve, reject };

      if (deadlineMs > 0) {
        node.timer = setTimeout(() => {
          const idx = this.queue.indexOf(node);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(
            new FfmpegQueueError(
              `antrian ffmpeg penuh (${process.env.FFMPEG_MAX_CONCURRENT || 1} sedang berjalan), coba lagi nanti`
            )
          );
        }, deadlineMs);
      }

      this.queue.push(node);
    });
  }

  private release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) {
      this.permits--;
      if (next.timer) clearTimeout(next.timer);
      next.resolve(() => this.release());
    }
  }
}

const MAX_CONCURRENT = Math.max(1, envInt("FFMPEG_MAX_CONCURRENT", 1));

let globalSemaphore = new Semaphore(MAX_CONCURRENT);
let unitCounter = 0;

export function buildUnitName(): string {
  return `kontenpilot-ffmpeg-${process.pid}-${Date.now()}-${unitCounter++}`;
}

export function buildSystemdArgs(
  args: string[],
  profile: FfmpegProfile,
  unit: string
): string[] {
  const cfg = getProfileConfig(profile);
  return [
    "--wait",
    "--pipe",
    "--quiet",
    "--unit",
    unit,
    "-p",
    `MemoryMax=${cfg.memoryMax}`,
    "-p",
    `MemorySwapMax=${cfg.swapMax}`,
    "-p",
    `CPUQuota=${cfg.cpuQuota}`,
    "--",
    "ffmpeg",
    ...args,
  ];
}

export function parseMeminfo(data: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of data.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(\d+)\s*kB/);
    if (m) out.set(m[1], parseInt(m[2], 10));
  }
  return out;
}

export function assertResourcesAvailable(
  meminfo: Map<string, number>,
  minAvailableMb: number
): void {
  const memAvailableKb = meminfo.get("MemAvailable") || 0;
  const swapFreeKb = meminfo.get("SwapFree") || 0;
  const swapTotalKb = meminfo.get("SwapTotal") || 0;

  if (Math.floor(memAvailableKb / 1024) < minAvailableMb) {
    throw new ResourceInsufficientError(
      `Resource tidak cukup (MemAvailable ${Math.floor(memAvailableKb / 1024)} MB < ${minAvailableMb} MB) — render ditunda, coba lagi nanti`
    );
  }

  if (swapTotalKb > 0 && swapFreeKb < swapTotalKb * 0.25) {
    throw new ResourceInsufficientError(
      `Resource tidak cukup (SwapFree ${Math.floor(swapFreeKb / 1024)} MB kurang dari 25%) — render ditunda, coba lagi nanti`
    );
  }
}

export async function checkMemoryAvailable(): Promise<void> {
  const data = await readFile("/proc/meminfo", "utf8");
  const meminfo = parseMeminfo(data);
  const minAvailableMb = envInt("RENDER_MIN_AVAILABLE_MB", 500);
  assertResourcesAvailable(meminfo, minAvailableMb);
}

// Test-only hooks. Jangan dipakai di production code.
let testExecutor: typeof execFileAsync | null = null;
export function __setExecFileAsync(fn: typeof execFileAsync | null): void {
  testExecutor = fn;
}

export function __resetSemaphore(permits: number): void {
  globalSemaphore = new Semaphore(Math.max(1, permits));
}

export async function runFfmpeg(
  args: string[],
  profile: FfmpegProfile = "render"
): Promise<{ stdout: string; stderr: string }> {
  const cfg = getProfileConfig(profile);
  const queueWaitMs = envInt("FFMPEG_QUEUE_WAIT_MS", 15 * 60 * 1000);
  const release = await globalSemaphore.acquire(queueWaitMs);
  const unit = buildUnitName();

  try {
    await checkMemoryAvailable();

    const scopedArgs = buildSystemdArgs(args, profile, unit);
    const executor = testExecutor || execFileAsync;

    try {
      return await (executor("systemd-run", scopedArgs, {
        maxBuffer: 1024 * 1024 * 64,
        timeout: cfg.timeoutMs,
        killSignal: "SIGKILL",
      } as ExecFileOptions) as Promise<{ stdout: string; stderr: string }>);
    } catch (err) {
      const stderr = ((err as { stderr?: string })?.stderr) || "";
      const isSIGKILL =
        (err as { killed?: boolean })?.killed &&
        (err as { signal?: string })?.signal === "SIGKILL";

      if (isSIGKILL) {
        // Hentikan unit terkait best-effort.
        const stopExecutor = testExecutor || execFileAsync;
        stopExecutor("systemctl", ["stop", `${unit}.service`], { timeout: 5000 }).catch(() => {});

        let oom = false;
        try {
          const { stdout } = await (stopExecutor("systemctl", [
            "show",
            `${unit}.service`,
            "--property=Result",
            "--property=ExecMainStatus",
          ], { timeout: 5000 }) as Promise<{ stdout: string }>);
          if (stdout.includes("Result=oom-kill")) oom = true;
        } catch {
          // ignore
        }

        const reason = oom
          ? "dihentikan karena melebihi batas memory (OOM)"
          : `melebihi batas waktu ${cfg.timeoutMs / 60000} menit`;
        throw new Error(
          `ffmpeg ${reason}, dihentikan paksa — kemungkinan render terlalu berat/macet (lihat insiden 2026-08-13, render 46 klip)`
        );
      }

      throw new Error(`ffmpeg gagal: ${(err as Error).message}\n${stderr.slice(-2000)}`);
    }
  } finally {
    release();
  }
}
