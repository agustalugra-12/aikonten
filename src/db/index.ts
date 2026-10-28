import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// (2026-10-28, Fase 4 wiring) sqlite di-export supaya pembaca DEFENSIF kolom scene_manifest
// (readSceneManifestColumn di processProject) bisa query mentah via try/catch TANPA menaruh
// kolom di objek tabel Drizzle `projects` - itu akan bikin SELECT lebar gagal di prod yg
// belum migrasi. Additive, tak ubah skema/koneksi.
export const sqlite = new Database(process.env.DATABASE_PATH || "./data/kontenpilot.db");
sqlite.pragma("journal_mode = WAL");
// (2026-10-23, Fase 0) busy_timeout: writer kedua MENUNGGU s/d 5 dtk saat DB sedang
// ditulis koneksi lain, bukan gagal instan SQLITE_BUSY (default 0). Penting saat tenant
// generate/publish menulis bersamaan. Tak ubah skema/data.
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
