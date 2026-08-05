import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { getOrGenerateDailyIdeas } from "@/lib/ai/dailyContentPlanner";

// Cron #1 - generate rencana ide harian utk SEMUA brand (2026-08-06, permintaan Agus,
// PRD scheduler - "ide konten memberikan idenya jam berapa"). Idempotent -
// getOrGenerateDailyIdeas SUDAH cek dailyIdeas existing utk hari ini, jadi aman dipanggil
// berkali-kali (systemd timer misfire/retry tidak bikin batch dobel). Direkomendasikan
// jalan ~03:00 WITA (lihat scripts/cron/kontenpilot-daily-ideas.timer) - awal pagi,
// sebelum jam sibuk VPS ini (PMS/AI Chat Bot/website publik).
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const allBrands = await db.select().from(brands);
  const results: Array<{ brandId: string; name: string; ok: boolean; count?: number; error?: string }> = [];

  for (const brand of allBrands) {
    try {
      const ideas = await getOrGenerateDailyIdeas(brand.id);
      results.push({ brandId: brand.id, name: brand.name, ok: true, count: ideas.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/daily-ideas] gagal utk brand ${brand.name} (${brand.id}):`, err);
      results.push({ brandId: brand.id, name: brand.name, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
