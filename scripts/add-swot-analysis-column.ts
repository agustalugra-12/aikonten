/**
 * Migrasi MANUAL ber-guard: tambah kolom swot_analysis ke tabel brands (2026-11-02, T3-rework).
 * Pola sama add-analytics-metric-columns / add-brand-kit (drizzle-kit migrate RUSAK - jangan dipakai).
 * Additive & nullable: baris lama = NULL -> aman. Idempoten: cek PRAGMA table_info dulu.
 * WAJIB jalan DULU sebelum deploy kode (skema drizzle emit kolom ini di SELECT brands).
 * Jalankan: DATABASE_PATH=./data/kontenpilot.db npx tsx scripts/add-swot-analysis-column.ts
 * (BACKUP dulu: cp data/kontenpilot.db data/kontenpilot.db.bak)
 */
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";
const db = new Database(dbPath, { fileMustExist: true });

const cols = (db.prepare("PRAGMA table_info(brands)").all() as Array<{ name: string }>).map((c) => c.name);
if (cols.includes("swot_analysis")) {
  console.log("[migrasi] kolom swot_analysis SUDAH ada - skip.");
} else {
  db.exec("ALTER TABLE brands ADD COLUMN swot_analysis text");
  console.log("[migrasi] kolom swot_analysis (text) ditambahkan.");
}
db.close();
