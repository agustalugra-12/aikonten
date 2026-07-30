import { NextResponse } from "next/server";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.select().from(socialAccounts).where(eq(socialAccounts.brandId, id));
  // Jangan pernah kirim accessToken/refreshToken ke client - cuma info yg perlu
  // ditampilkan di dashboard.
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      publishVia: r.publishVia,
      username: r.username,
    }))
  );
}
