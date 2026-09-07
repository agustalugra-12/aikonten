import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { manualIdeas } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { parseIdeaFile } from "@/lib/ai/manualIdeaParser";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Bank Ide Manual (2026-08-06, permintaan Agus - "menambahkan ide konten secara manual
// dsini dalam bentuk excel maupun pdf jadi akan otomatis disimpan dan diambil sebagai
// bahan konten"). Upload LANGSUNG multipart ke route ini (BEDA dari pola presigned-URL
// yg dipakai footage/logo - itu utk file besar yg tidak perlu diproses server, file ide
// ini KECIL & WAJIB diparse server-side segera, jadi terima bytes langsung lebih simpel,
// tidak perlu app-storage utk file mentahnya sama sekali).
//
// Varian JSON (2026-08-19, AI Content Planning Engine) - staf "Terima" 1 saran AI dari
// tab Rencana Konten kirim {"idea": "..."} langsung (bukan file) - sama tabel/mekanisme
// FIFO, cuma beda sumber & bentuk body, `source` ditandai "ai-content-plan-suggestion"
// biar kelihatan asalnya di daftar Bank Ide.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;

  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const body = await req.json();
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    if (!idea) {
      return NextResponse.json({ error: "idea wajib diisi" }, { status: 400 });
    }
    await db.insert(manualIdeas).values({
      id: newId("mide"),
      brandId,
      idea,
      source: "ai-content-plan-suggestion",
      used: false,
      createdAt: new Date(),
    });
    return NextResponse.json({ ok: true, count: 1 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "File wajib diupload (field 'file')" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ideaTexts = await parseIdeaFile(buffer, file.name);
    if (ideaTexts.length === 0) {
      return NextResponse.json({ error: "Tidak ada ide yang terbaca dari file ini - pastikan 1 ide per baris" }, { status: 400 });
    }

    const now = new Date();
    const rows = ideaTexts.map((idea) => ({
      id: newId("mide"),
      brandId,
      idea,
      source: file.name,
      used: false,
      createdAt: now,
    }));
    await db.insert(manualIdeas).values(rows);

    return NextResponse.json({ ok: true, count: rows.length, ideas: ideaTexts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// List Bank Ide (2026-08-06) - utk UI lihat apa yg sudah terupload & belum dipakai,
// termasuk yg SUDAH dipakai (biar Agus tahu sudah masuk konten yg mana, bukan hilang
// tanpa jejak).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const ideas = await db
    .select()
    .from(manualIdeas)
    .where(eq(manualIdeas.brandId, brandId))
    .orderBy(desc(manualIdeas.createdAt))
    .limit(200);
  return NextResponse.json({ ideas });
}

// Hapus 1 ide (2026-08-06) - salah upload/typo, Agus mau buang manual sebelum kepakai.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { ideaId } = await req.json();
  if (!ideaId || typeof ideaId !== "string") {
    return NextResponse.json({ error: "ideaId wajib diisi" }, { status: 400 });
  }
  await db.delete(manualIdeas).where(and(eq(manualIdeas.id, ideaId), eq(manualIdeas.brandId, brandId)));
  return NextResponse.json({ ok: true });
}
