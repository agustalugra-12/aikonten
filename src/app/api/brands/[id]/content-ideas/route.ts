import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { suggestContentIdeas } from "@/lib/ai/researchTopics";
import { getUserId, getOwnedBrand } from "@/lib/session";

// "Research Engine" ringan (lihat memory proyek) - usul ide konten berdasarkan niche
// brand + histori skrip brand ini, BUKAN data tren real-time (keputusan Agus: pakai
// pengetahuan GPT saja, bukan API tren berbayar).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const recentProjects = await db
    .select({ script: projects.script })
    .from(projects)
    .where(eq(projects.brandId, brandId))
    .orderBy(desc(projects.createdAt))
    .limit(15);

  const recentScripts = recentProjects.map((p) => p.script).filter((s): s is string => !!s);

  try {
    const ideas = await suggestContentIdeas(brand.name, brand.description, recentScripts, 4, [], brand.knowledgeSite, brand.manualKnowledge, brand.contentPillars);
    return NextResponse.json({ ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
