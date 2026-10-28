// Scene Manifest persistence (2026-10-28, Fase 4 wiring) - pembaca DEFENSIF kolom
// projects.scene_manifest. Modul SENGAJA TANPA import berat (tak impor db/ffmpeg/ai) supaya
// bisa dites dgn DB in-memory tanpa boot seluruh pipeline + koneksi DB prod.
//
// KENAPA defensif (bukan kolom di objek tabel Drizzle `projects`): kalau kolom ditaruh di
// skema Drizzle, SEMUA `db.select().from(projects)` emit `scene_manifest` -> gagal "no such
// column" di DB prod yg BELUM migrasi -> crash. Di sini query MENTAH via try/catch -> kolom
// absen / DB error -> null -> pemanggil pakai flow render LAMA. Artinya kode AMAN di-deploy
// walau migrasi belum jalan ("batas adapter aman", sesuai batasan Agus).
//
// `database` = better-sqlite3 Database (objek `sqlite` yg di-export dari @/db, atau DB
// in-memory di test) - type-only import, tanpa biaya runtime.
import type Database from "better-sqlite3";

export function readSceneManifestColumn(database: Database.Database, projectId: string): string | null {
  try {
    const row = database.prepare("SELECT scene_manifest FROM projects WHERE id = ?").get(projectId) as
      | { scene_manifest?: string | null }
      | undefined;
    return row?.scene_manifest ?? null;
  } catch {
    return null;
  }
}
