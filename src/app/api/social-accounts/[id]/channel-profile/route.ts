import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channelProfiles, socialAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

// Channel Profile CRUD (2026-08-10, PRD Agus "YouTube Long Form Content Engine" +
// "YouTube Shorts Engine" - "buat dia memiliki editorial policy dan YouTube growth
// strategy"). Tabel channelProfiles SUDAH ADA di schema sejak 2026-08-08 (fondasi PRD
// "YouTube Content & Monetization Safety System") TAPI TIDAK PERNAH dipakai sama sekali
// - tidak ada route, tidak ada UI (dicek langsung, 0 pemakaian di seluruh kode). Route
// ini yang PERTAMA benar-benar memakainya - "editorial policy" per channel (niche/
// kategori/topik dilarang-disukai/audiens) yang dibaca youtubeEditorial.ts.
//
// Top-level /api/social-accounts/[id]/... (BUKAN nested /api/brands/[id]/social-
// accounts/[id]/...) krn socialAccountId sudah unik global & channel profile murni
// milik akun itu, tidak perlu context brand tambahan di URL.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: socialAccountId } = await params;
  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, socialAccountId));
  if (!account) return NextResponse.json({ error: "Akun sosial media tidak ditemukan" }, { status: 404 });

  const [profile] = await db.select().from(channelProfiles).where(eq(channelProfiles.socialAccountId, socialAccountId));
  if (!profile) return NextResponse.json(null);

  return NextResponse.json({
    id: profile.id,
    primaryNiche: profile.primaryNiche,
    contentPillars: profile.contentPillars ? JSON.parse(profile.contentPillars) : [],
    forbiddenTopics: profile.forbiddenTopics ? JSON.parse(profile.forbiddenTopics) : [],
    preferredTopics: profile.preferredTopics ? JSON.parse(profile.preferredTopics) : [],
    language: profile.language,
    targetCountry: profile.targetCountry,
    targetAudience: profile.targetAudience,
    youtubeCategoryId: profile.youtubeCategoryId,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: socialAccountId } = await params;
  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, socialAccountId));
  if (!account) return NextResponse.json({ error: "Akun sosial media tidak ditemukan" }, { status: 404 });
  if (account.platform !== "youtube") {
    return NextResponse.json({ error: "Channel Profile/editorial policy hanya relevan utk akun YouTube" }, { status: 400 });
  }

  const body = await req.json();
  const {
    primaryNiche, contentPillars, forbiddenTopics, preferredTopics,
    language, targetCountry, targetAudience, youtubeCategoryId,
  } = body;

  if (
    (contentPillars !== undefined && !Array.isArray(contentPillars)) ||
    (forbiddenTopics !== undefined && !Array.isArray(forbiddenTopics)) ||
    (preferredTopics !== undefined && !Array.isArray(preferredTopics))
  ) {
    return NextResponse.json({ error: "contentPillars/forbiddenTopics/preferredTopics harus array string" }, { status: 400 });
  }

  const [existing] = await db.select().from(channelProfiles).where(eq(channelProfiles.socialAccountId, socialAccountId));
  const now = new Date();

  const values = {
    primaryNiche: primaryNiche ?? null,
    contentPillars: contentPillars ? JSON.stringify(contentPillars) : null,
    forbiddenTopics: forbiddenTopics ? JSON.stringify(forbiddenTopics) : null,
    preferredTopics: preferredTopics ? JSON.stringify(preferredTopics) : null,
    language: language ?? null,
    targetCountry: targetCountry ?? null,
    targetAudience: targetAudience ?? null,
    youtubeCategoryId: youtubeCategoryId ?? null,
    updatedAt: now,
  };

  if (existing) {
    await db.update(channelProfiles).set(values).where(eq(channelProfiles.id, existing.id));
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const id = newId("chprofile");
  await db.insert(channelProfiles).values({ id, socialAccountId, ...values, createdAt: now });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
