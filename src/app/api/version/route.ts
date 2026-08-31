import { NextResponse } from "next/server";
import { execSync } from "child_process";

// Ops health endpoint (Phase 5) - expose build/run identity supaya drift antar 2 server
// KontenPilot terlihat dalam 1x cek. Hanya commit SHA + waktu start + environment;
// tidak ada data bisnis/PII. Dibuka publik via proxy.ts PUBLIC_PATHS.
function resolveSha(): string {
  if (process.env.KONTENPILOT_GIT_SHA) {
    return process.env.KONTENPILOT_GIT_SHA;
  }
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const sha = resolveSha();
const startedAt = new Date().toISOString();

export async function GET() {
  return NextResponse.json({
    sha,
    startedAt,
    nodeEnv: process.env.NODE_ENV || "development",
  });
}
