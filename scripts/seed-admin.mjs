// Seed 1x: buat baris user admin tunggal (id statis "user_admin") yang dipakai semua
// brand sbg pemilik - app ini single-admin (lihat PRD diskusi), bukan multi-tenant,
// jadi tidak ada flow signup. Jalankan sekali setelah migrate: node scripts/seed-admin.mjs
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH || "./data/kontenpilot.db";
const db = new Database(dbPath);

const existing = db.prepare("SELECT id FROM users WHERE id = ?").get("user_admin");
if (existing) {
  console.log("User admin sudah ada, skip.");
} else {
  db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
  ).run("user_admin", "admin@kontenpilot.local", "unused_see_env_admin_password_hash", Date.now());
  console.log("User admin dibuat.");
}
