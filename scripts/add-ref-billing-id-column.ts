/**
 * Migrasi MANUAL ber-guard (2026-11-06, billing-hardening P0): tambah kolom `ref_billing_id`
 * (TEXT, nullable) ke credit_transactions + INDEKS UNIK PARSIAL (kunci idempotensi grant kredit
 * dari pembayaran = billingLog.id -> satu tagihan tak bisa meng-grant kredit dua kali).
 *
 * Pola SAMA dgn scripts/add-scene-manifest-column.ts (drizzle-kit migrate RUSAK - jangan dipakai).
 * - Additive & nullable: baris lama = NULL (transaksi non-pembayaran) -> indeks unik parsial
 *   mengabaikan NULL, jadi baris lama aman. Tak sentuh/ubah data yg sudah ada.
 * - Idempoten: cek PRAGMA table_info + IF NOT EXISTS (aman dijalankan ulang).
 * - Rollback: kolom+indeks nullable tak dipakai kode lama -> cukup BIARKAN (aman). Atau setelah
 *   revert kode: DROP INDEX ux_credtx_ref_billing; ALTER TABLE credit_transactions DROP COLUMN ref_billing_id;
 *
 * URUTAN DEPLOY WAJIB: jalankan migrasi ini DULU, BARU deploy kode yg menulis ref_billing_id.
 * Jalankan: DATABASE_PATH=/path/ke/kontenpilot.db npx tsx scripts/add-ref-billing-id-column.ts
 * (BACKUP dulu: cp kontenpilot.db kontenpilot.db.bak-YYYYMMDD)
 */
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";
const db = new Database(dbPath, { fileMustExist: true });

const cols = db.prepare("PRAGMA table_info(credit_transactions)").all() as Array<{ name: string }>;
if (cols.some((c) => c.name === "ref_billing_id")) {
  console.log("[migrasi] kolom ref_billing_id SUDAH ada - skip (idempoten).");
} else {
  db.exec("ALTER TABLE credit_transactions ADD COLUMN ref_billing_id text");
  console.log("[migrasi] kolom ref_billing_id ditambahkan (TEXT nullable).");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_credtx_ref_billing ON credit_transactions(ref_billing_id) WHERE ref_billing_id IS NOT NULL");
console.log("[migrasi] indeks unik parsial ux_credtx_ref_billing siap (anti double-credit).");

db.close();
