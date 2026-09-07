import { NextRequest, NextResponse } from "next/server";
import { detectContentFatigue } from "@/lib/ai/contentFatigue";
import { getUserId, getOwnedBrand } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedBrand(userId, id))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  try {
    const fatigue = await detectContentFatigue(id);
    return NextResponse.json(fatigue);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
