import { NextResponse } from "next/server";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAggregatedMetrics } from "@/lib/publish/bufferAuth";

// Analitik "ambil dari Buffer saja" (keputusan Agus - bukan integrasi terpisah ke tiap
// API platform native). Cuma berlaku utk akun yg publishVia="buffer" - akun native
// (mis. YouTube nanti) belum ada sumber datanya, ditandai available:false, bukan error.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.brandId, brandId));

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const results = await Promise.all(
    accounts.map(async (acc) => {
      const base = { id: acc.id, platform: acc.platform, username: acc.username };
      if (acc.publishVia !== "buffer" || !acc.bufferChannelId) {
        return { ...base, available: false as const };
      }
      try {
        const metrics = await getAggregatedMetrics(
          acc.bufferChannelId,
          sevenDaysAgo.toISOString(),
          now.toISOString()
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
