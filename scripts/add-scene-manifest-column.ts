/**
 * Migrasi MANUAL ber-guard: tambah kolom `scene_manifest` (TEXT, nullable) ke tabel projects.
 * (2026-10-28, Fase 4 - persistence Scene Manifest JSON, fondasi Timeline Editor Fase 5.)
 *
 * Pola SAMA dgn scripts/add-brand-kit-column.ts (drizzle-kit migrate RUSAK - jangan dipakai).
 * - Additive & nullable: baris lama = NULL -> resolveSceneManifest(null) -> null -> flow render
 *   LAMA (nol dampak perilaku). Tak sentuh/ubah data yg sudah ada.
 * - Idempoten: cek PRAGMA table_info dulu, skip kalau kolom sudah ada (aman dijalankan ulang).
 * - Rollback: kolom nullable tak dipakai kode lama -> cukup BIARKAN (aman). Atau, setelah revert
 *   kode: `ALTER TABLE projects DROP COLUMN scene_manifest;` (SQLite >= 3.35).
 *
 * URUTAN DEPLOY WAJIB: jalankan migrasi ini DULU di server, BARU deploy kode yg membaca kolom
 * (readSceneManifestColumn defensif tetap aman walau terbalik, tapi urutan ini yg benar).
 *
 * Jalankan: DATABASE_PATH=/path/ke/kontenpilot.db npx tsx scripts/add-scene-manifest-column.ts
 * (BACKUP dulu: cp kontenpilot.db kontenpilot.db.bak-YYYYMMDD)
 */
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";
const db = new Database(dbPath, { fileMustExist: true });

const cols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
const exists = cols.some((c) => c.name === "scene_manifest");

if (exists) {
  console.log("[migrasi] kolom scene_manifest SUDAH ada - skip (idempoten).");
} else {
  db.exec("ALTER TABLE projects ADD COLUMN scene_manifest text");
  console.log("[migrasi] kolom scene_manifest ditambahkan (TEXT nullable).");
}

db.close();
