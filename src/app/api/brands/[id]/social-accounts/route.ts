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

// Khusus TikTok/Buffer - beda dari YouTube/Meta yg pakai alur OAuth redirect penuh,
// Buffer cuma perlu Agus MEMILIH salah satu channel yg sudah tersambung di Buffer
// (lihat /api/auth/buffer/channels) utk dikaitkan ke brand ini.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const { bufferChannelId, username } = await req.json();

  if (typeof bufferChannelId !== "string" || !bufferChannelId) {
    return NextResponse.json({ error: "bufferChannelId wajib diisi" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.brandId, brandId),
        eq(socialAccounts.platform, "tiktok"),
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
    platform: "tiktok" as const,
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
