/* eslint-disable no-console */
// Verification gate Fase 2.1 + 2.3: server memory config.
// Jalankan dengan: npx --yes tsx scripts/verify-fase2-config.ts

import { readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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

async function main() {
  console.log("Running Fase 2 verification gate: server config\n");

  const memoryConf = await readFile(
    "/etc/systemd/system/kontenpilot-backend.service.d/memory.conf",
    "utf8"
  );
  check(
    "drop-in memory.conf exists with MemorySwapMax=512M",
    memoryConf.includes("MemorySwapMax=512M")
  );

  const { stdout: showOut } = await execAsync(
    "systemctl show kontenpilot-backend --property=MemorySwapMax"
  );
  const swapMaxBytes = parseInt(showOut.split("=")[1]?.trim() || "", 10);
  check(
    "kontenpilot-backend MemorySwapMax active = 512M",
    swapMaxBytes === 512 * 1024 * 1024,
    `got ${swapMaxBytes}`
  );

  const { stdout: memHighOut } = await execAsync(
    "systemctl show kontenpilot-backend --property=MemoryHigh --property=MemoryMax"
  );
  check(
    "MemoryHigh/MemoryMax unchanged (1800M/2200M)",
    memHighOut.includes("MemoryHigh=1887436800") && memHighOut.includes("MemoryMax=2306867200"),
    memHighOut.trim()
  );

  const sysctlConf = await readFile("/etc/sysctl.d/60-kp-reserve.conf", "utf8");
  check(
    "sysctl drop-in exists with vm.min_free_kbytes=131072",
    sysctlConf.includes("vm.min_free_kbytes=131072")
  );

  const { stdout: sysctlOut } = await execAsync("sysctl -n vm.min_free_kbytes");
  const minFree = parseInt(sysctlOut.trim(), 10);
  check("vm.min_free_kbytes active = 131072", minFree === 131072, `got ${minFree}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
