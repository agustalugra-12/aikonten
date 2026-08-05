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

  // Volume harian 3 tipe (2026-08-05, revisi Agus - awalnya total WAJIB 10 [2 tipe],
  // sekarang total BEBAS sejumlah yg di-set ("4 foto, 4 vidio, 4 curasel artinya 12
  // konten") - validasi cuma masing2 integer >= 0 & totalnya >= 1 (bukan 0 semua).
  if ("dailyVideoCount" in body || "dailySinglePhotoCount" in body || "dailyCarouselCount" in body) {
    const videoCount = "dailyVideoCount" in body ? Number(body.dailyVideoCount) : existing.dailyVideoCount;
    const fotoCount = "dailySinglePhotoCount" in body ? Number(body.dailySinglePhotoCount) : existing.dailySinglePhotoCount;
    const carouselCount = "dailyCarouselCount" in body ? Number(body.dailyCarouselCount) : existing.dailyCarouselCount;
    if (
      !Number.isInteger(videoCount) || !Number.isInteger(fotoCount) || !Number.isInteger(carouselCount) ||
      videoCount < 0 || fotoCount < 0 || carouselCount < 0
    ) {
      return NextResponse.json({ error: "dailyVideoCount/dailySinglePhotoCount/dailyCarouselCount harus integer >= 0" }, { status: 400 });
    }
    if (videoCount + fotoCount + carouselCount < 1) {
      return NextResponse.json({ error: "Total video+foto+carousel harus minimal 1" }, { status: 400 });
    }
    update.dailyVideoCount = videoCount;
    update.dailySinglePhotoCount = fotoCount;
    update.dailyCarouselCount = carouselCount;
  }

  // Durasi target video (2026-08-05, permintaan Agus - "video 30 detik 60 detik dan
  // 1.30") - cuma 3 preset ini yg didukung processProject.ts.
  if ("videoDurationTarget" in body) {
    const v = Number(body.videoDurationTarget);
    if (![30, 60, 90].includes(v)) {
      return NextResponse.json({ error: "videoDurationTarget harus 30, 60, atau 90" }, { status: 400 });
    }
    update.videoDurationTarget = v;
  }

  // Foto per post carousel (2026-08-05, permintaan Agus - "carousel 3 foto, 5 foto, 7
  // foto") - cuma 3 preset ini yg didukung NewProjectDialog/auto-content route.
  if ("carouselPhotosPerPost" in body) {
    const v = Number(body.carouselPhotosPerPost);
    if (![3, 5, 7].includes(v)) {
      return NextResponse.json({ error: "carouselPhotosPerPost harus 3, 5, atau 7" }, { status: 400 });
    }
    update.carouselPhotosPerPost = v;
  }

  // Orientasi video (2026-08-05, permintaan Agus - "landscape atau potrait utk YT").
  if ("videoOrientation" in body) {
    if (body.videoOrientation !== "portrait" && body.videoOrientation !== "landscape") {
      return NextResponse.json({ error: "videoOrientation harus 'portrait' atau 'landscape'" }, { status: 400 });
    }
    update.videoOrientation = body.videoOrientation;
  }

  // Knowledge Base manual (2026-08-05, permintaan Agus - "setiap brand bisa mengisi
  // pengetahuan secara manual") - melengkapi fakta otomatis, bukan menggantikan.
  if ("manualKnowledge" in body) {
    if (body.manualKnowledge !== null && typeof body.manualKnowledge !== "string") {
      return NextResponse.json({ error: "manualKnowledge harus string atau null" }, { status: 400 });
    }
    update.manualKnowledge = body.manualKnowledge;
  }

  // Knowledge Base per-brand (2026-08-05, permintaan Agus) - "pelangi"/"harmoni" saja yg
  // valid (satu2nya situs yg didukung endpoint content-facts web-pelangi, lihat
  // pelangiKnowledge.ts), null = belum di-set (fallback ke "pelangi" di kode pemanggil).
  if ("knowledgeSite" in body) {
    if (body.knowledgeSite !== null && body.knowledgeSite !== "pelangi" && body.knowledgeSite !== "harmoni") {
      return NextResponse.json({ error: "knowledgeSite harus 'pelangi', 'harmoni', atau null" }, { status: 400 });
    }
    update.knowledgeSite = body.knowledgeSite;
  }

  // Draft vs Auto-Publish (2026-08-06, permintaan Agus - "pilihan draft atau langsung
  // publis"). autoPublishTime WAJIB diisi format "HH:MM" kalau publishMode="auto" -
  // divalidasi di sini SEKALIGUS (bukan 2 field independen) supaya tidak mungkin
  // tersimpan "auto" tanpa jam, atau jam tanpa mode - kombinasi yg tidak masuk akal.
  if ("publishMode" in body || "autoPublishTime" in body) {
    const publishMode = "publishMode" in body ? body.publishMode : existing.publishMode;
    const autoPublishTime = "autoPublishTime" in body ? body.autoPublishTime : existing.autoPublishTime;
    if (publishMode !== "draft" && publishMode !== "auto") {
      return NextResponse.json({ error: "publishMode harus 'draft' atau 'auto'" }, { status: 400 });
    }
    if (publishMode === "auto") {
      if (typeof autoPublishTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(autoPublishTime)) {
        return NextResponse.json({ error: "autoPublishTime wajib diisi format HH:MM (WITA) kalau publishMode='auto'" }, { status: 400 });
      }
    }
    update.publishMode = publishMode;
    update.autoPublishTime = publishMode === "auto" ? autoPublishTime : null;
  }

  await db.update(brands).set(update).where(eq(brands.id, id));
  const [updated] = await db.select().from(brands).where(eq(brands.id, id));
  return NextResponse.json(updated);
}
