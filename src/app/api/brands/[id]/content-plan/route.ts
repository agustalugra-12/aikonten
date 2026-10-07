import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contentPlan, brands } from "@/db/schema";
import { and, eq, gte, asc } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";
import { newId } from "@/lib/ids";

// Content Planner editable (2026-10-05, PRD Planner Fase 1 - permintaan Agus). GANTI versi
// lama (yg read-only + backward gabung ide/project). Sekarang: sumber = tabel content_plan,
// FORWARD (>= hari ini WITA), editable.
//   GET                -> baris rencana forward brand ini.
//   POST { size }      -> buat KERANGKA N konten (30/60/90/120/150), tanggal ikut cadence
//                         harian brand (dailyVideoCount+dailySinglePhotoCount+dailyCarouselCount
//                         = slot/hari, sama dgn cron). Reset baris "direncanakan" forward dulu.
//   POST { ...row }    -> tambah 1 baris manual.
const ALLOWED_SIZES = [30, 60, 90, 120, 150];

// WITA = UTC+8. Geser ke WITA lalu ambil tanggalnya (string YYYY-MM-DD, aman utk compare).
function witaDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(contentPlan)
    .where(and(eq(contentPlan.brandId, brandId), gte(contentPlan.date, witaDate(0))))
    .orderBy(asc(contentPlan.date), asc(contentPlan.slotIndex));
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const now = new Date();

  // Bulk set auto/manual (2026-10-05) - set SEMUA baris "direncanakan" forward. bulkAutoMode
  // "auto" = baris disetujui ikut cron (auto-generate di tanggalnya + auto-publish).
  if (body.bulkAutoMode === "auto" || body.bulkAutoMode === "manual") {
    await db
      .update(contentPlan)
      .set({ autoMode: body.bulkAutoMode, updatedAt: now })
      .where(and(eq(contentPlan.brandId, brandId), eq(contentPlan.status, "direncanakan"), gte(contentPlan.date, witaDate(0))));
    return NextResponse.json({ ok: true, bulkAutoMode: body.bulkAutoMode });
  }

  // --- Kerangka N konten ---
  if (body.size !== undefined) {
    const size = Number(body.size);
    if (!ALLOWED_SIZES.includes(size)) {
      return NextResponse.json({ error: "size harus 30, 60, 90, 120, atau 150" }, { status: 400 });
    }
    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
    // Pola harian = campuran tipe sesuai cadence cron brand. Kosong (semua 0) -> 1 carousel/hari.
    const pattern: ("video" | "foto" | "carousel")[] = [
      ...Array(Math.max(0, brand?.dailyVideoCount ?? 0)).fill("video"),
      ...Array(Math.max(0, brand?.dailySinglePhotoCount ?? 0)).fill("foto"),
      ...Array(Math.max(0, brand?.dailyCarouselCount ?? 0)).fill("carousel"),
    ];
    if (pattern.length === 0) pattern.push("carousel");
    const slotsPerDay = pattern.length;
    const values = Array.from({ length: size }, (_, i) => ({
      id: newId("cpln"),
      brandId,
      date: witaDate(Math.floor(i / slotsPerDay)),
      slotIndex: i % slotsPerDay,
      contentType: pattern[i % slotsPerDay],
      status: "direncanakan" as const,
      createdAt: now,
      updatedAt: now,
    }));
    // Reset HANYA baris yg masih "direncanakan" & forward (regen kerangka) - baris yg sudah
    // digenerate/terjadwal/publish JANGAN disentuh (kerja owner tak boleh hilang).
    await db
      .delete(contentPlan)
      .where(and(eq(contentPlan.brandId, brandId), eq(contentPlan.status, "direncanakan"), gte(contentPlan.date, witaDate(0))));
    await db.insert(contentPlan).values(values);
    return NextResponse.json({ ok: true, count: values.length });
  }

  // --- Tambah 1 baris manual ---
  const row = {
    id: newId("cpln"),
    brandId,
    date: typeof body.date === "string" ? body.date : witaDate(0),
    slotIndex: Number(body.slotIndex) || 0,
    contentType: (["video", "foto", "carousel"].includes(body.contentType) ? body.contentType : "carousel") as
      | "video"
      | "foto"
      | "carousel",
    pillar: body.pillar ?? null,
    hook: body.hook ?? null,
    topic: body.topic ?? null,
    scriptBrief: body.scriptBrief ?? null,
    draftCaption: body.draftCaption ?? null,
    draftHashtags: Array.isArray(body.draftHashtags) ? JSON.stringify(body.draftHashtags) : body.draftHashtags ?? null,
    status: "direncanakan" as const,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(contentPlan).values(row);
  return NextResponse.json({ ok: true, row });
}
