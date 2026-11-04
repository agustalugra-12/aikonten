// Migrasi IDEMPOTEN tabel publish-guard. Urutan deploy WAJIB: backup DB -> skrip ini -> build -> restart.
// Skrip ini SELALU membuat backup dulu (better-sqlite3 online backup) sebelum DDL, lalu verifikasi.
//   Cek saja   : npx tsx scripts/migrate-publish-ledger.ts --db data/kontenpilot.db --check
//   Terapkan   : npx tsx scripts/migrate-publish-ledger.ts --db data/kontenpilot.db --backup /path/backup.db
// --db WAJIB eksplisit (tak ada default -> cegah salah DB).
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { LEDGER_DDL, LEDGER_TABLES } from "../src/lib/publish/ledgerSchema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function presentTables(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${LEDGER_TABLES.map(() => "?").join(",")})`).all(...LEDGER_TABLES) as { name: string }[];
  return rows.map((r) => r.name).sort();
}

export async function migratePublishLedger(dbPath: string, backupPath: string): Promise<{ before: string[]; after: string[] }> {
  if (!existsSync(dbPath)) throw new Error(`DB tidak ditemukan: ${dbPath}`);
  const db = new Database(dbPath);
  try {
    await db.backup(backupPath); // 1) backup DULU
    const before = presentTables(db);
    db.transaction(() => { for (const ddl of LEDGER_DDL) db.exec(ddl); })(); // 2) DDL idempoten, atomik
    const after = presentTables(db);
    if (after.length !== LEDGER_TABLES.length) throw new Error(`verifikasi gagal: tabel ada=${after.join(",")}`);
    return { before, after };
  } finally {
    db.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate-publish-ledger.ts")) {
  (async () => {
    const dbPath = arg("--db");
    if (!dbPath) { console.error("WAJIB --db <path>"); process.exit(2); }
    if (process.argv.includes("--check")) {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const have = presentTables(db); db.close();
      console.log(JSON.stringify({ present: have, missing: LEDGER_TABLES.filter((t) => !have.includes(t)) }));
      return;
    }
    const backup = arg("--backup");
    if (!backup) { console.error("WAJIB --backup <path> (backup dibuat sebelum migrasi)"); process.exit(2); }
    const r = await migratePublishLedger(dbPath, backup);
    console.log(`OK migrasi publish-ledger. backup=${backup} sebelum=[${r.before}] sesudah=[${r.after}]`);
  })().catch((e) => { console.error("MIGRASI GAGAL:", e.message); process.exit(1); });
}
