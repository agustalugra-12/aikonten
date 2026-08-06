import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAggregatedMetrics } from "@/lib/publish/bufferAuth";

// Analitik "ambil dari Buffer saja" (keputusan Agus - bukan integrasi terpisah ke tiap
// API platform native). Cuma berlaku utk akun yg publishVia="buffer" - akun native
// (mis. YouTube nanti) belum ada sumber datanya, ditandai available:false, bukan error.
//
// Jendela waktu default DINAIKKAN 7 -> 30 hari (2026-08-06, laporan Agus - "di laundry
// in bali sudah ada dari 2024 dan sudah posting" tapi analitik nunjukin 0). BUKAN bug
// pengambilan data - dicek langsung ke API Buffer asli, post lama-nya BENERAN ada
// (~Maret 2026), TAPI Buffer sendiri MENOLAK keras jendela >31 hari utk akun free-plan
// ("Free-plan Insights are limited to the last 31 days of history" - error asli dari
// API, dites langsung sampai ke akar masalah, bukan dugaan). 30 hari (bukan 31, sedikit
// margin aman) = jendela TERLUAS yang masih valid utk akun manapun (Pelangi paid-plan
// atau brand baru free-plan spt Laundry In Bali). Post yg LEBIH LAMA dari 30 hari
// (mis. histori Maret 2026 brand ini) memang TIDAK BISA ditampilkan sampai akun Buffer
// brand itu di-upgrade dari free plan - bukan sesuatu yg bisa diperbaiki dari sisi kode
// app ini. `days` query param opsional kalau nanti perlu jendela lebih pendek.
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.brandId, brandId));

  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const results = await Promise.all(
    accounts.map(async (acc) => {
      const base = { id: acc.id, platform: acc.platform, username: acc.username };
      if (acc.publishVia !== "buffer" || !acc.bufferChannelId) {
        return { ...base, available: false as const };
      }
      try {
        const metrics = await getAggregatedMetrics(
          acc.bufferChannelId,
          startDate.toISOString(),
          now.toISOString(),
          acc.accessToken
        );
        return { ...base, available: true as const, metrics };
      } catch (err) {
        return {
          ...base,
          available: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return NextResponse.json(results);
}
