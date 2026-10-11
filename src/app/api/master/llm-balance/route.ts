import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { llmBalances } from "@/db/schema";
import { getAdminOrNull } from "@/lib/admin";
import { newId } from "@/lib/ids";

// Admin input saldo provider AI (OpenAI/Gemini) utk basis estimasi "sisa" (2026-10-11).
// Tiap input = baseline baru (entry terbaru dipakai). Hanya admin.
export async function POST(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const { provider, amountUsd, note } = await req.json().catch(() => ({}));
  if (typeof provider !== "string" || !["openai", "gemini"].includes(provider)) {
    return NextResponse.json({ error: "provider harus 'openai' atau 'gemini'" }, { status: 400 });
  }
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt < 0) {
    return NextResponse.json({ error: "amountUsd harus angka >= 0" }, { status: 400 });
  }
  await db.insert(llmBalances).values({
    id: newId("bal"),
    provider,
    amountUsd: amt,
    note: typeof note === "string" && note.trim() ? note.trim() : null,
    createdAt: Math.floor(Date.now() / 1000),
  });
  return NextResponse.json({ ok: true });
}
