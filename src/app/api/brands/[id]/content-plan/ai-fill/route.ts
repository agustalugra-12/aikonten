import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contentPlan } from "@/db/schema";
import { and, eq, gte, asc } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";
import { generatePlanEntries, generateScriptsFromHooks } from "@/lib/ai/planFill";

// Planner Fase 2 (2026-10-05) - "AI Isi Rencana". DUA fase:
//  (1) baris KOSONG (tanpa hook & topik) -> isi penuh (pillar/hook/topik/skrip/caption/hashtag).
//  (2) baris yg SUDAH ada hook/topik tapi SKRIP kosong -> isi skrip saja dari hook/topik
//      (tak menimpa hook/caption owner). Fix temuan Agus: baris lama (di-fill sebelum fitur
//      skrip) tak pernah dapat skrip krn fase (1) melewatinya. Teks saja - tanpa Gemini.
function witaDate(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const has = (v: string | null | undefined) => !!(v && v.trim());

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(contentPlan)
    .where(and(eq(contentPlan.brandId, brandId), eq(contentPlan.status, "direncanakan"), gte(contentPlan.date, witaDate())))
    .orderBy(asc(contentPlan.date), asc(contentPlan.slotIndex));

  const fullyEmpty = rows.filter((r) => !has(r.hook) && !has(r.topic));
  const needScript = rows.filter((r) => (has(r.hook) || has(r.topic)) && !has(r.scriptBrief));

  if (fullyEmpty.length === 0 && needScript.length === 0) {
    return NextResponse.json({ ok: true, filled: 0, message: "Semua baris sudah terisi." });
  }

  const now = new Date();
  let filled = 0;

  // Fase 1 - isi penuh baris kosong
  if (fullyEmpty.length > 0) {
    const entries = await generatePlanEntries(brandId, fullyEmpty.length);
    for (let i = 0; i < fullyEmpty.length && i < entries.length; i++) {
      const e = entries[i];
      await db
        .update(contentPlan)
        .set({
          pillar: e.pillar || null,
          hook: e.hook || null,
          topic: e.topic || null,
          scriptBrief: e.script || null,
          draftCaption: e.caption || null,
          draftHashtags: e.hashtags.length > 0 ? e.hashtags.join(" ") : null,
          updatedAt: now,
        })
        .where(eq(contentPlan.id, fullyEmpty[i].id));
      filled++;
    }
  }

  // Fase 2 - isi SKRIP saja utk baris yg sudah ada hook tapi skrip kosong
  if (needScript.length > 0) {
    const scripts = await generateScriptsFromHooks(
      brandId,
      needScript.map((r) => ({ hook: r.hook || "", topic: r.topic || "", contentType: r.contentType }))
    );
    for (let i = 0; i < needScript.length && i < scripts.length; i++) {
      if (has(scripts[i])) {
        await db.update(contentPlan).set({ scriptBrief: scripts[i].trim(), updatedAt: now }).where(eq(contentPlan.id, needScript[i].id));
        filled++;
      }
    }
  }

  return NextResponse.json({ ok: true, filled });
}
