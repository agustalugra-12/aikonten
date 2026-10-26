// Idempotent schema helper (2026-10-26, Phase 2 Font Studio) - tambah kolom
// `brands.brand_kit` (TEXT, nullable) KALAU belum ada. Konsisten dgn konvensi repo ini:
// perubahan schema = ALTER MANUAL ber-guard, BUKAN `drizzle-kit migrate` (rusak/desync di
// server ini - meng-recreate semua tabel; lihat RUNBOOK_SAAS.md). AMAN diulang
// (idempoten): cek PRAGMA dulu, skip kalau kolom sudah ada. TIDAK membuat migrasi Drizzle.
//
// Path DB pakai konvensi yg SAMA dgn src/db/index.ts (env DATABASE_PATH, fallback ke
// ./data/kontenpilot.db) - TIDAK hardcode path produksi.
//
// Usage:
//   npx tsx scripts/add-brand-kit-column.ts
//   DATABASE_PATH=/path/ke/kontenpilot.db npx tsx scripts/add-brand-kit-column.ts
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";

function main(): void {
  let db: Database.Database;
  try {
    // fileMustExist: jangan diam2 BIKIN DB kosong baru kalau path salah - itu menyesatkan
    // (seolah "berhasil"). Lebih baik GAGAL JELAS supaya operator tahu path-nya keliru.
    db = new Database(dbPath, { fileMustExist: true });
  } catch (e) {
    console.error(`[add-brand-kit-column] GAGAL buka DB di "${dbPath}": ${(e as Error).message}`);
    console.error("  (pastikan path benar via env DATABASE_PATH, dan file DB sudah ada / schema terinisialisasi)");
    process.exitCode = 1;
    return;
  }

  try {
    // PRAGMA table_info balik array KOSONG kalau tabel 'brands' tak ada - perlakukan sbg
    // "tak bisa diinspeksi" (schema belum siap), GAGAL JELAS drpd lanjut buta.
    const cols = db.prepare("PRAGMA table_info(brands)").all() as Array<{ name: string }>;
    if (cols.length === 0) {
      console.error(`[add-brand-kit-column] GAGAL: tabel 'brands' tidak ditemukan di "${dbPath}" - schema belum terinisialisasi?`);
      process.exitCode = 1;
      return;
    }

    if (cols.some((c) => c.name === "brand_kit")) {
      console.log(`[add-brand-kit-column] SKIP: kolom 'brand_kit' sudah ada di "${dbPath}" - tak ada perubahan (idempoten).`);
      return;
    }

    db.exec("ALTER TABLE `brands` ADD `brand_kit` text");
    console.log(`[add-brand-kit-column] OK: kolom 'brand_kit' (TEXT, nullable) ditambahkan ke "${dbPath}".`);
  } catch (e) {
    console.error(`[add-brand-kit-column] GAGAL inspeksi/ubah schema di "${dbPath}": ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
