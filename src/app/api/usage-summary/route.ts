import { NextResponse } from "next/server";
import { db } from "@/db";
import { llmUsageLog } from "@/db/schema";
import { gte } from "drizzle-orm";
import { sql } from "drizzle-orm";

// Ringkasan biaya AI KontenPilot (2026-08-06, permintaan Agus - "cek ai blok dan ai
// konten juga agar transparan") - GLOBAL (fal.ai + OpenAI blm dipisah per-brand, cukup
// utk jawab "berapa biaya KontenPilot total hari ini", sama semangat dgn AI Blog/ai-
// chat-bot yg sudah dibuat hari yg sama.
export async function GET() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      model: llmUsageLog.model,
      calls: sql<number>`count(*)`,
      totalTokens: sql<number>`sum(${llmUsageLog.totalTokens})`,
      costUsd: sql<number>`sum(${llmUsageLog.costUsd})`,
    })
    .from(llmUsageLog)
    .where(gte(llmUsageLog.ts, startOfDay))
    .groupBy(llmUsageLog.model);

  const totalCostToday = rows.reduce((sum, r) => sum + (r.costUsd || 0), 0);

  return NextResponse.json({
    totalCostToday,
    byModel: rows.map((r) => ({
      model: r.model,
      calls: r.calls,
      totalTokens: r.totalTokens || null,
      costUsd: r.costUsd || 0,
    })),
  });
}
