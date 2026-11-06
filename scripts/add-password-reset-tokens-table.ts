/**
 * Migrasi MANUAL ber-guard (2026-11-06, billing-hardening P1.6): buat tabel password_reset_tokens
 * utk reset password mandiri. Token disimpan sbg HASH (sha256), sekali pakai + kedaluwarsa.
 * - Idempoten: CREATE TABLE/INDEX IF NOT EXISTS (aman dijalankan ulang). Additive (tabel baru).
 * - Rollback: DROP TABLE password_reset_tokens; (hanya setelah revert kode reset/forgot).
 * Jalankan: DATABASE_PATH=/path/ke/kontenpilot.db npx tsx scripts/add-password-reset-tokens-table.ts
 */
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";
const db = new Database(dbPath, { fileMustExist: true });

db.exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL,
  expires_at integer NOT NULL,
  used_at integer,
  created_at integer NOT NULL
)`);
db.exec("CREATE INDEX IF NOT EXISTS ix_prt_token_hash ON password_reset_tokens(token_hash)");
console.log("[migrasi] tabel password_reset_tokens + indeks ix_prt_token_hash siap.");

db.close();
