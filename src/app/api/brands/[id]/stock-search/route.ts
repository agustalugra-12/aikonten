import { NextRequest, NextResponse } from "next/server";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Pencarian stok Pexels (2026-10-05, Fase B ganti footage) - daftar hasil utk picker modal.
// Video mp4 resolusi tertinggi per hasil. Beda dari lib/assets/pexels.ts (itu pilih 1 acak
// utk pipeline) - di sini owner yang memilih dari daftar.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "PEXELS_API_KEY belum diisi" }, { status: 500 });
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=12`;
    const r = await fetch(url, { headers: { Authorization: apiKey } });
    if (!r.ok) throw new Error();
    const data = await r.json();
    const results = ((data.videos || []) as Array<{ duration?: number; image?: string; video_files?: Array<{ link: string; file_type: string; width?: number }> }>)
      .map((v) => {
        const mp4 = (v.video_files || []).filter((f) => f.file_type === "video/mp4").sort((a, b) => (b.width || 0) - (a.width || 0));
        const file = mp4[0];
        return file ? { fileUrl: file.link, durationSeconds: v.duration ?? null, posterUrl: v.image ?? null } : null;
      })
      .filter(Boolean);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Pencarian stok gagal." }, { status: 502 });
  }
}
