import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands, socialAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildContentBrief } from "@/lib/ai/contentBrief";
import { getUserId, getOwnedProject } from "@/lib/session";

// Content Brief (PRD §12, Task Plan 6) - READ-ONLY, tidak ada panggilan AI di sini sama
// sekali (lihat catatan lengkap di contentBrief.ts) - murni assembly dari project + brand.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));
  const accounts = await db.select({ platform: socialAccounts.platform }).from(socialAccounts).where(eq(socialAccounts.brandId, project.brandId));
  const connectedPlatforms = Array.from(new Set(accounts.map((a) => a.platform)));

  const brief = buildContentBrief(project, brand ?? null, connectedPlatforms);
  return NextResponse.json(brief);
}
