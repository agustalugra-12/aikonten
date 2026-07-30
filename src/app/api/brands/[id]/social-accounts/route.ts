import { NextResponse } from "next/server";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.select().from(socialAccounts).where(eq(socialAccounts.brandId, id));
  // Jangan pernah kirim accessToken/refreshToken ke client - cuma info yg perlu
  // ditampilkan di dashboard.
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      publishVia: r.publishVia,
      username: r.username,
    }))
  );
}

// Buffer bisa dipakai utk platform APA SAJA yg Agus sambungkan di Buffer sendiri
// (TikTok, Instagram, dst - lihat memory proyek: awalnya cuma TikTok krn API
// langsungnya butuh audit, tapi Instagram juga dipakai lewat Buffer sementara selagi
// uji coba gratis). Beda dari YouTube/Meta yg pakai alur OAuth redirect penuh, di sini
// Agus cuma MEMILIH salah satu channel yg sudah tersambung di Buffer (lihat
// /api/auth/buffer/channels) utk dikaitkan ke brand ini - platform-nya ikut dari
// `service` channel itu, BUKAN di-hardcode.
const SUPPORTED_BUFFER_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const { bufferChannelId, username, platform } = await req.json();

  if (typeof bufferChannelId !== "string" || !bufferChannelId) {
    return NextResponse.json({ error: "bufferChannelId wajib diisi" }, { status: 400 });
  }
  if (!SUPPORTED_BUFFER_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `Platform "${platform}" belum didukung app ini (didukung: ${SUPPORTED_BUFFER_PLATFORMS.join(", ")})` },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.brandId, brandId),
        eq(socialAccounts.platform, platform),
        eq(socialAccounts.bufferChannelId, bufferChannelId)
      )
    );

  if (existing) {
    await db.update(socialAccounts).set({ username }).where(eq(socialAccounts.id, existing.id));
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const row = {
    id: newId("social"),
    brandId,
    platform: platform as (typeof SUPPORTED_BUFFER_PLATFORMS)[number],
    publishVia: "buffer" as const,
    username,
    platformAccountId: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    bufferChannelId,
    createdAt: new Date(),
  };
  await db.insert(socialAccounts).values(row);
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}
