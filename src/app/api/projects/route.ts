import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets } from "@/db/schema";
import { newId } from "@/lib/ids";
import { eq, desc, inArray } from "drizzle-orm";

// Preview ringkas per project (2026-08-13, permintaan Agus - "rapikan tampilan AI
// konten spt Buffer, jelaskan jam publish & video pendek/panjang") - SEBELUM ini
// endpoint ini cuma balikin baris projects mentah (tanpa media), jadi daftar konten
// tidak bisa nunjukkin thumbnail/durasi tanpa fetch detail SATU-SATU per baris (pola N+1
// yg dipakai DraftReview.tsx, oke utk draft yg sedikit, TIDAK oke utk daftar SEMUA
// konten yg bisa puluhan/ratusan baris). 1 query tambahan (bukan N+1) ambil SEMUA
// final_video/final_image milik brand ini sekaligus, dikelompokkan per project di JS.
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId wajib diisi" }, { status: 400 });
  }
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.brandId, brandId))
    .orderBy(desc(projects.createdAt));

  if (rows.length === 0) return NextResponse.json([]);

  const assets = await db
    .select()
    .from(mediaAssets)
    .where(inArray(mediaAssets.projectId, rows.map((r) => r.id)));

  const previewByProject = new Map<string, { previewUrl: string; previewType: "video" | "image"; durationSeconds: number | null }>();
  for (const a of assets) {
    if (a.type !== "final_video" && a.type !== "final_image") continue;
    const existing = previewByProject.get(a.projectId);
    // Video diutamakan drpd gambar kalau project py keduanya (tidak pernah terjadi
    // dlm praktik, tapi video lebih representatif drpd 1 gambar kalau ambigu) - & yg
    // PERTAMA ketemu per tipe dipakai (cukup utk thumbnail, bukan galeri penuh).
    if (existing?.previewType === "video") continue;
    if (a.type === "final_video") {
      previewByProject.set(a.projectId, { previewUrl: a.fileUrl, previewType: "video", durationSeconds: a.durationSeconds });
    } else if (!existing) {
      previewByProject.set(a.projectId, { previewUrl: a.fileUrl, previewType: "image", durationSeconds: null });
    }
  }

  const enriched = rows.map((r) => ({ ...r, ...(previewByProject.get(r.id) ?? { previewUrl: null, previewType: null, durationSeconds: null }) }));
  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const { brandId, type, script } = await req.json();
  if (typeof brandId !== "string" || !brandId) {
    return NextResponse.json({ error: "brandId wajib diisi" }, { status: 400 });
  }
  if (type !== "video" && type !== "carousel") {
    return NextResponse.json({ error: "type harus 'video' atau 'carousel'" }, { status: 400 });
  }

  const now = new Date();
  const row = {
    id: newId("proj"),
    brandId,
    type,
    status: "uploaded" as const,
    script: script || null,
    transcript: null,
    clipSelection: null,
    generatedCaption: null,
    generatedHashtags: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(projects).values(row);
  return NextResponse.json(row, { status: 201 });
}
