import { NextRequest, NextResponse } from "next/server";
import { detectContentFatigue } from "@/lib/ai/contentFatigue";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const fatigue = await detectContentFatigue(id);
    return NextResponse.json(fatigue);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
