import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { socialAccounts, analytics } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAggregatedMetrics } from "@/lib/publish/bufferAuth";
import { newId } from "@/lib/ids";

// Cron - isi snapshot harian tabel `analytics` (2026-08-19, PRD "AI Content Intelligence"
// §25-34 Analytics/Reporting, permintaan Agus). Tabel ini SUDAH ADA di schema sejak lama
// tapi TIDAK PERNAH DIISI kode mana pun - laporan tren dari waktu ke waktu (bulan lalu vs
// bulan ini) butuh histori ini, dan histori tidak bisa direkonstruksi mundur, jadi makin
// cepat mulai terkumpul makin baik.
//
// Sumber data: SAMA PERSIS dgn yg sudah dipakai & terverifikasi ke API Buffer asli di
// endpoint dashboard (/api/brands/[id]/analytics, lihat AnalyticsSummary.tsx) -
// getAggregatedMetrics per channel, tipe metrik nyata (introspeksi API, BUKAN dugaan):
// views/reach/reactions/shares/engagementRate. Kolom `analytics.likes` diisi dari metrik
// `reactions` (istilah Buffer utk "suka" lintas-platform, bukan field literal "likes" -
// field itu TIDAK ADA di response API asli). Kolom `analytics.followers` DIBIARKAN NULL -
// belum ada query Buffer GraphQL yg terverifikasi expose follower count per channel,
// jangan tebak/fabrikasi field yg belum dicek ke API asli (pola sama spt komentar
// getPostMetrics di bufferAuth.ts).
//
// Jendela metrik: 1 hari (kemarin 00:00 - hari ini 00:00 waktu server) - merepresentasikan
// aktivitas HARI ITU, konsisten dgn nama kolom `dateRecorded`. Idempotent: cek row
// existing utk (socialAccountId, dateRecorded) dulu, UPDATE kalau ada (misfire/retry timer
// tidak bikin baris dobel) bukan INSERT buta.
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.connected, true));
  const today = new Date();
  const dateRecorded = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const windowStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const results: Array<{ accountId: string; username: string; ok: boolean; error?: string }> = [];

  for (const acc of accounts) {
    if (acc.publishVia !== "buffer" || !acc.bufferChannelId) {
      continue; // akun native (mis. YouTube langsung) belum ada sumber metrik harian
    }
    try {
      const metrics = await getAggregatedMetrics(
        acc.bufferChannelId,
        windowStart.toISOString(),
        today.toISOString(),
        acc.accessToken
      );
      const views = metrics.find((m) => m.type === "views")?.value ?? null;
      const reactions = metrics.find((m) => m.type === "reactions")?.value ?? null;

      const existing = await db
        .select({ id: analytics.id })
        .from(analytics)
        .where(and(eq(analytics.socialAccountId, acc.id), eq(analytics.dateRecorded, dateRecorded)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(analytics)
          .set({ views: views !== null ? Math.round(views) : null, likes: reactions !== null ? Math.round(reactions) : null })
          .where(eq(analytics.id, existing[0].id));
      } else {
        await db.insert(analytics).values({
          id: newId("an"),
          socialAccountId: acc.id,
          followers: null,
          views: views !== null ? Math.round(views) : null,
          likes: reactions !== null ? Math.round(reactions) : null,
          dateRecorded,
          createdAt: new Date(),
        });
      }
      results.push({ accountId: acc.id, username: acc.username, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/daily-analytics] gagal utk akun ${acc.username} (${acc.id}):`, err);
      results.push({ accountId: acc.id, username: acc.username, ok: false, error: message });
    }
  }

  return NextResponse.json({ dateRecorded, results });
}
