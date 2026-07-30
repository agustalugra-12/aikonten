import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { newId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";

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
  return NextResponse.json(rows);
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
