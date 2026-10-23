import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

// Health/uptime (2026-10-23). Cek proses hidup + DB bisa di-query. Publik (ditambah ke
// PUBLIC_PATHS proxy.ts). Dipakai monitor eksternal / cron ping utk deteksi down cepat.
export async function GET() {
  try {
    db.all(sql`SELECT 1`);
    return NextResponse.json({ ok: true, db: "ok", time: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, db: "error", error: (e as Error).message }, { status: 503 });
  }
}
