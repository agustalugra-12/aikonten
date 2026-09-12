import { NextRequest, NextResponse } from "next/server";
import { tryDiscoverContentUrlsFromAccount, buildCreatorBenchmarkFromContentUrls } from "@/lib/agustap/creatorBenchmark";
import { runWithUsageContext } from "@/lib/ai/usageContext";

// Creator Benchmark UMUM (2026-09-12, PRD - jadikan fitur ini tersedia utk semua brand,
// bukan cuma AgustaP). REUSE fungsi existing (tryDiscoverContentUrlsFromAccount +
// buildCreatorBenchmarkFromContentUrls -> analyzeInspiration LLM). Ephemeral: hasil
// dikembalikan ke UI, belum dipersistensikan (tak ada tabel benchmark; persistensi =
// follow-up bila perlu). Cost tercatat via runWithUsageContext. Tanpa mock.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await req.json().catch(() => ({}));
  const creatorName = typeof body.creatorName === "string" ? body.creatorName.trim() : "";
  const accountUrl = typeof body.accountUrl === "string" ? body.accountUrl.trim() : "";
  const contentUrls = Array.isArray(body.contentUrls) ? body.contentUrls.filter((u: unknown): u is string => typeof u === "string" && !!u.trim()).map((u: string) => u.trim()) : [];

  if (!creatorName) return NextResponse.json({ ok: false, error: "INPUT", detail: "Nama kreator wajib diisi" }, { status: 400 });

  let urls = contentUrls;
  if (urls.length === 0 && accountUrl) {
    urls = await tryDiscoverContentUrlsFromAccount(accountUrl);
  }
  if (urls.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "NO_URLS",
      detail: "Tidak ada URL konten. Banyak akun (TikTok/IG/YT) JS-rendered sehingga link tak bisa ditemukan otomatis - tempel beberapa URL konten langsung.",
    });
  }

  try {
    const result = await runWithUsageContext({ brandId, projectId: undefined }, () =>
      buildCreatorBenchmarkFromContentUrls(urls.slice(0, 20), creatorName)
    );
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: "FAILED", detail }, { status: 500 });
  }
}
