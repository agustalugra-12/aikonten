// Deployment drift check (Phase 5) - bandingkan commit SHA & start time antar target
// server KontenPilot. Pure read, no side effect. Bisa dipakai post-deploy health check
// untuk mitigasi risiko drift 2-server (ENGINEERING_SAFETY.md Lampiran C).
//
// Usage:
//   npx tsx scripts/check-deployment.ts https://server-a.example.com https://server-b.example.com
//   DEPLOYMENT_TARGETS="https://a.com,https://b.com" npx tsx scripts/check-deployment.ts

import { execSync } from "child_process";

type VersionInfo = { sha: string; startedAt: string; nodeEnv: string };

function localHeadSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return process.env.KONTENPILOT_GIT_SHA || "unknown";
  }
}

function getTargets(): string[] {
  const fromArgs = process.argv.slice(2).filter((a) => a.startsWith("http://") || a.startsWith("https://"));
  if (fromArgs.length > 0) return fromArgs;
  const fromEnv = process.env.DEPLOYMENT_TARGETS;
  return fromEnv ? fromEnv.split(",").map((u) => u.trim()).filter(Boolean) : [];
}

async function fetchVersion(url: string): Promise<VersionInfo | { error: string }> {
  try {
    const res = await fetch(`${url}/api/version`, { cache: "no-store" });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as VersionInfo;
    return data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function formatIso(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
  } catch {
    return iso;
  }
}

async function main() {
  const targets = getTargets();
  if (targets.length === 0) {
    console.error("Usage: npx tsx scripts/check-deployment.ts <url1> [url2] ...");
    console.error("   atau set DEPLOYMENT_TARGETS=https://a.com,https://b.com");
    process.exit(1);
  }

  const localSha = localHeadSha();
  console.log(`Local HEAD: ${localSha}\n`);

  const results = await Promise.all(
    targets.map(async (url) => {
      const info = await fetchVersion(url);
      return { url, info };
    })
  );

  let failed = false;

  for (const { url, info } of results) {
    if ("error" in info) {
      console.error(`FAIL ${url} — ${info.error}`);
      failed = true;
      continue;
    }
    const match = info.sha === localSha;
    if (!match) failed = true;
    const marker = match ? "OK" : "DRIFT";
    console.log(`${marker} ${url}`);
    console.log(`   SHA:  ${info.sha}`);
    console.log(`   Start: ${formatIso(info.startedAt)} WITA`);
    console.log(`   Env:   ${info.nodeEnv}`);
  }

  console.log(failed ? "\n=== ADA DRIFT / GAGAL FETCH ===" : "\n=== SEMUA SERVER MATCH ===");
  process.exit(failed ? 1 : 0);
}

main();
