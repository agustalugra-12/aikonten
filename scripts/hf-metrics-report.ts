// Metrik render HyperFrames dari projects.auto_fix_log (READ-ONLY). Pakai:
//   npx tsx scripts/hf-metrics-report.ts <path.db> [hari=7] [usd_worker_per_jam=0]
import Database from "better-sqlite3";
import { summarizeRenderMetrics, type LogEntry } from "../src/lib/video/renderQc";
const [dbPath, days = "7", usdHr = "0"] = process.argv.slice(2);
if (!dbPath) { console.error("pakai: hf-metrics-report.ts <path.db> [hari] [usd/jam]"); process.exit(2); }
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT auto_fix_log AS l FROM projects WHERE type='video' AND created_at >= ? AND auto_fix_log IS NOT NULL").all(Math.floor(Date.now() / 1000) - Number(days) * 86400) as { l: string }[];
const logs: LogEntry[][] = rows.map((r) => { try { const j = JSON.parse(r.l); return Array.isArray(j) ? j : []; } catch { return []; } });
console.log(JSON.stringify(summarizeRenderMetrics(logs, { workerUsdPerHour: Number(usdHr) }), null, 2));
