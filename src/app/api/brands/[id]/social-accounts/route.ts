import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { ensurePlatformPolicyEnabled } from "@/lib/policy/platformPolicy";
import { getUserId, getOwnedBrand } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedBrand(userId, id))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db.select().from(socialAccounts).where(eq(socialAccounts.brandId, id));
  // Jangan pernah kirim accessToken/refreshToken ke client - cuma info yg perlu
  // ditampilkan di dashboard.
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      publishVia: r.publishVia,
      username: r.username,
      // Status koneksi/token (2026-09-12) - NON-sensitif (bukan token itu sendiri),
      // dipakai halaman Kanal Terhubung utk tampilkan status nyata (tersambung/token
      // segera kedaluwarsa/terputus). token_expires_at cuma relevan utk akun native
      // (YouTube/Meta OAuth); akun Buffer null (tak apa).
      connected: r.connected,
      tokenExpiresAt: r.tokenExpiresAt ?? null,
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { bufferChannelId, username, platform, bufferAccessToken } = await req.json();

  if (typeof bufferChannelId !== "string" || !bufferChannelId) {
    return NextResponse.json({ error: "bufferChannelId wajib diisi" }, { status: 400 });
  }
  if (!SUPPORTED_BUFFER_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `Platform "${platform}" belum didukung app ini (didukung: ${SUPPORTED_BUFFER_PLATFORMS.join(", ")})` },
      { status: 400 }
    );
  }
  if (bufferAccessToken !== undefined && bufferAccessToken !== null && typeof bufferAccessToken !== "string") {
    return NextResponse.json({ error: "bufferAccessToken harus string" }, { status: 400 });
  }

  // Token Buffer PER-AKUN (2026-08-06, permintaan Agus - "laundry in bali" pakai akun
  // Buffer sendiri) - disimpan di accessToken (field yg SUDAH ADA, sebelumnya SELALU
  // null utk akun Buffer - publishViaBuffer cuma pakai env var global). Null kalau tidak
  // diisi (brand pakai akun Buffer default/bersama via env var, perilaku lama).
  const accessToken = bufferAccessToken || null;

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
    await db.update(socialAccounts).set({ username, accessToken }).where(eq(socialAccounts.id, existing.id));
    // Auto-enable Platform Policy (2026-08-08, PRD "YouTube Content & Monetization
    // Safety System" Section 4) - jalur Buffer JUGA bisa dipakai utk connect YouTube
    // (lihat SUPPORTED_BUFFER_PLATFORMS di atas), bukan cuma jalur native OAuth
    // (auth/youtube/callback) - no-op utk platform selain youtube (lihat
    // PLATFORM_PROFILES di platformPolicy.ts).
    await ensurePlatformPolicyEnabled(brandId, platform as (typeof SUPPORTED_BUFFER_PLATFORMS)[number]);
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const row = {
    id: newId("social"),
    brandId,
    platform: platform as (typeof SUPPORTED_BUFFER_PLATFORMS)[number],
    publishVia: "buffer" as const,
    username,
    platformAccountId: null,
    accessToken,
    refreshToken: null,
    tokenExpiresAt: null,
    bufferChannelId,
    createdAt: new Date(),
  };
  await db.insert(socialAccounts).values(row);
  await ensurePlatformPolicyEnabled(brandId, row.platform);
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}
