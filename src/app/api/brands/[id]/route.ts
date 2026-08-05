import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";

// Update brand - awalnya khusus logoUrl (2026-08-05), sekarang jg dailyVideoCount/
// dailyCarouselCount (2026-08-05, permintaan Agus - "dari 10 konten ini 3 dibuat foto
// 7 dibuat video", lihat DailyContentPlanner.tsx). PATCH (bukan PUT) - update
// sebagian field, konsisten dgn pola REST project lain. Semua field OPSIONAL - kirim
// yg mau diubah saja.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const [existing] = await db.select().from(brands).where(eq(brands.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const update: Partial<typeof existing> = {};

  if ("logoUrl" in body) {
    if (body.logoUrl !== null && typeof body.logoUrl !== "string") {
      return NextResponse.json({ error: "logoUrl harus string atau null" }, { status: 400 });
    }
    update.logoUrl = body.logoUrl;
  }

  if ("dailyVideoCount" in body || "dailyCarouselCount" in body) {
    const videoCount = "dailyVideoCount" in body ? Number(body.dailyVideoCount) : existing.dailyVideoCount;
    const carouselCount = "dailyCarouselCount" in body ? Number(body.dailyCarouselCount) : existing.dailyCarouselCount;
    if (!Number.isInteger(videoCount) || !Number.isInteger(carouselCount) || videoCount < 0 || carouselCount < 0) {
      return NextResponse.json({ error: "dailyVideoCount/dailyCarouselCount harus integer >= 0" }, { status: 400 });
    }
    if (videoCount + carouselCount !== 10) {
      return NextResponse.json(
        { error: `Total video+foto harus 10 (Content Planner harian selalu 10 ide) - sekarang ${videoCount}+${carouselCount}=${videoCount + carouselCount}` },
        { status: 400 }
      );
    }
    update.dailyVideoCount = videoCount;
    update.dailyCarouselCount = carouselCount;
  }

  await db.update(brands).set(update).where(eq(brands.id, id));
  const [updated] = await db.select().from(brands).where(eq(brands.id, id));
  return NextResponse.json(updated);
}
