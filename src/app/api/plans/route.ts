import { NextResponse } from "next/server";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { eq } from "drizzle-orm";

// Daftar paket aktif (2026-09-08, Fase 1 Alur A) - dibaca halaman "pilih paket" setelah
// signup. Read-only, tanpa input - aman diakses siapa pun yang sudah login (middleware.ts
// sudah menjamin itu, route ini tidak perlu isolasi tambahan krn `plans` bukan data milik
// tenant tertentu, sama utk semua calon pelanggan).
export async function GET() {
  const rows = await db.select().from(plans).where(eq(plans.aktif, true));
  return NextResponse.json(
    rows.map((p) => ({
      id: p.id,
      nama: p.nama,
      kreditBulanan: p.kreditBulanan,
      hargaBulananIdr: p.hargaBulananIdr,
      izinAutoPosting: p.izinAutoPosting,
      maxBrand: p.maxBrand,
    }))
  );
}
