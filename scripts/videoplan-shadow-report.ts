// Ringkasan log shadow VideoPlan (read-only). Pakai: npx tsx scripts/videoplan-shadow-report.ts [path.jsonl]
import { readFileSync } from "node:fs";
import { summarizeShadow, shadowLogPath } from "../src/lib/video/videoPlanDirector";
console.log(JSON.stringify(summarizeShadow(readFileSync(process.argv[2] || shadowLogPath(), "utf8").split("\n")), null, 2));
