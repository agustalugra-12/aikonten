import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";
import {
  buildCreatorBenchmarkFromContentUrls,
  tryDiscoverContentUrlsFromAccount,
} from "@/lib/agustap/creatorBenchmark";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Competitor Intelligence - CRUD data kompetitor (2026-08-19, PRD §5, "tanpa API
// berbayar"). Input MANUAL staf - lihat catatan lengkap di db/schema.ts & AI
// lib/ai/competitorAnalysis.ts soal kenapa ini bukan integrasi otomatis.
//
// (2026-09-02) EXTEND - Creator Benchmark (PRD Agustap Studio §2.1.A, §2.11-2.12).
// Field baru (role/contentUrls/accountUrl) SEMUA OPSIONAL - request lama
// `{name, notes}` dari brand LAIN (SWOT manual) berperilaku 100% SAMA PERSIS
// seperti sebelumnya (tidak ada field baru dikirim -> tidak ada analisis
// dijalankan, row polos spt biasa).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db.select().from(competitors).where(eq(competitors.brandId, brandId)).orderBy(desc(competitors.updatedAt));
  return NextResponse.json({ competitors: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json();
  const { name, notes, role, contentUrls, accountUrl } = body as {
    name?: string;
    notes?: string;
    role?: string;
    contentUrls?: string[];
    accountUrl?: string;
  };
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nama kompetitor wajib diisi" }, { status: 400 });
  }

  let benchmarkProfile: string | null = null;
  let analyzedContentCount: number | null = null;
  let finalNotes = typeof notes === "string" ? notes : null;

  // §2.1.A/§2.11-2.12: kalau contentUrls diberikan langsung, pakai itu. Kalau
  // cuma accountUrl, coba discover dulu (best-effort minimal, lihat
  // creatorBenchmark.ts) - kalau kosong, TIDAK gagal keras, cuma tidak ada
  // profile (row tetap dibuat, staf bisa isi contentUrls manual belakangan).
  const urls: string[] =
    Array.isArray(contentUrls) && contentUrls.length > 0
      ? contentUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : accountUrl && typeof accountUrl === "string"
        ? await tryDiscoverContentUrlsFromAccount(accountUrl)
        : [];

  if (urls.length > 0) {
    const result = await buildCreatorBenchmarkFromContentUrls(urls, name.trim());
    if (result.ok) {
      benchmarkProfile = JSON.stringify(result.profile);
      analyzedContentCount = result.analyzedContentCount;
    } else {
      finalNotes = `${finalNotes ? finalNotes + "\n" : ""}[Analisis gagal: ${result.detail}]`;
    }
  }

  const now = new Date();
  const row = {
    id: newId("comp"),
    brandId,
    name: name.trim(),
    notes: finalNotes,
    createdAt: now,
    updatedAt: now,
    accountUrl: typeof accountUrl === "string" ? accountUrl : null,
    benchmarkProfile,
    role: typeof role === "string" && role.trim() ? role.trim() : null,
    benchmarkActive: false, // §2.16: harus diaktifkan eksplisit, tidak otomatis ON
    analyzedContentCount,
  };
  await db.insert(competitors).values(row);
  return NextResponse.json({ competitor: row });
}
