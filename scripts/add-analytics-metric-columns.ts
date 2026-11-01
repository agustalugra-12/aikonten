/**
 * Migrasi MANUAL ber-guard: tambah kolom reach/shares/engagement_rate ke tabel analytics.
 * (2026-11-01, Analytics v2 - simpan metrik historis, bukan cuma views/likes.)
 * Pola sama add-brand-kit/scene-manifest (drizzle-kit migrate RUSAK - jangan dipakai).
 * - Additive & nullable: baris lama = NULL -> aman. Idempoten: cek PRAGMA table_info dulu.
 * - WAJIB jalan DULU sebelum deploy kode (skema drizzle emit kolom ini di SELECT analytics).
 * Jalankan: DATABASE_PATH=./data/kontenpilot.db npx tsx scripts/add-analytics-metric-columns.ts
 * (BACKUP dulu: cp kontenpilot.db kontenpilot.db.bak)
 */
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";
const db = new Database(dbPath, { fileMustExist: true });

const cols = (db.prepare("PRAGMA table_info(analytics)").all() as Array<{ name: string }>).map((c) => c.name);
const add: Array<[string, string]> = [
  ["reach", "integer"],
  ["shares", "integer"],
  ["engagement_rate", "real"],
];
for (const [name, type] of add) {
  if (cols.includes(name)) {
    console.log(`[migrasi] kolom ${name} SUDAH ada - skip.`);
  } else {
    db.exec(`ALTER TABLE analytics ADD COLUMN ${name} ${type}`);
    console.log(`[migrasi] kolom ${name} (${type}) ditambahkan.`);
  }
}
db.close();
