import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { manualIdeas } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; inspirationId: string }> }) {
  const { inspirationId } = await params;
  await db.delete(manualIdeas).where(eq(manualIdeas.id, inspirationId));
  return NextResponse.json({ ok: true });
}
