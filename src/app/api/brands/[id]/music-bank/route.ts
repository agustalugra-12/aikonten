import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { musicBank } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getAudioDurationSeconds } from "@/lib/ai/dubbing";
import { getUserId, getOwnedBrand } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(musicBank)
    .where(eq(musicBank.brandId, brandId))
    .orderBy(desc(musicBank.createdAt));
  return NextResponse.json(rows);
}

// Music Bank (2026-08-10, lihat schema.ts musicBank - Pexels/Pixabay TIDAK PUNYA API
// musik, jadi ini SELALU upload manual Agus, BEDA dari footage-bank yg dianalisis AI
// vision otomatis). title+mood diketik/dipilih manual Agus saat upload (mood musik itu
// penilaian subjektif, tidak proporsional dianalisis otomatis dari audio utk skala app
// ini) - durasi SATU-SATUNYA yg dihitung otomatis (ffprobe, akurat, drpd nanya manual).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { fileUrl, title, mood } = await req.json();

  if (typeof fileUrl !== "string" || !fileUrl) {
    return NextResponse.json({ error: "fileUrl wajib diisi" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title wajib diisi" }, { status: 400 });
  }
  const validMoods = ["calm", "mysterious", "upbeat", "dramatic", "neutral"];
  if (!validMoods.includes(mood)) {
    return NextResponse.json({ error: `mood harus salah satu dari: ${validMoods.join(", ")}` }, { status: 400 });
  }

  try {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Gagal ambil file audio yg baru diupload: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const durationSeconds = Math.round(await getAudioDurationSeconds(buffer));

    const row = {
      id: newId("music"),
      brandId,
      fileUrl,
      title: title.trim(),
      mood: mood as "calm" | "mysterious" | "upbeat" | "dramatic" | "neutral",
      durationSeconds,
      createdAt: new Date(),
    };
    await db.insert(musicBank).values(row);
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
