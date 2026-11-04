// DDL tabel publish-guard (2026-11-04). Prod TIDAK memakai `drizzle-kit migrate` (tak ada tabel
// __drizzle_migrations; snapshot drizzle basi -> migrasi hasil generate ikut membuat ulang tabel lama dan
// GAGAL). Satu-satunya jalur: scripts/migrate-publish-ledger.ts (idempoten, backup dulu).
// Dipakai juga oleh ledgerReady() dan tes (DB temp).
export const LEDGER_TABLES = ["buffer_call_ledger", "buffer_token_state", "buffer_pending_checks"] as const;

export const LEDGER_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS buffer_call_ledger (
    id TEXT PRIMARY KEY NOT NULL, token_fp TEXT NOT NULL, brand_id TEXT, channel_id TEXT,
    kind TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS buffer_call_ledger_token_created ON buffer_call_ledger (token_fp, created_at)`,
  `CREATE TABLE IF NOT EXISTS buffer_token_state (
    token_fp TEXT PRIMARY KEY NOT NULL, cooldown_until INTEGER, reason TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS buffer_pending_checks (
    id TEXT PRIMARY KEY NOT NULL, publish_log_id TEXT NOT NULL, project_id TEXT NOT NULL,
    social_account_id TEXT NOT NULL, brand_id TEXT, channel_id TEXT NOT NULL, token_fp TEXT NOT NULL,
    platform TEXT, platform_post_id TEXT NOT NULL, post_text TEXT NOT NULL, dup_handled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, done_at INTEGER, result TEXT)`,
  `CREATE INDEX IF NOT EXISTS buffer_pending_open ON buffer_pending_checks (done_at, channel_id)`,
];
