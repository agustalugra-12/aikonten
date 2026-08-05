import { NextRequest, NextResponse } from "next/server";

// Proxy media dari storage kita sendiri (R2) LEWAT domain aplikasi ini, bukan hotlink
// langsung ke pub-*.r2.dev (2026-08-05, bug nyata dilaporkan Agus - draft foto tidak
// bisa dibuka sama sekali, baik lewat dashboard MAUPUN link R2 langsung dibuka terpisah,
// di WiFi MAUPUN data seluler - dicek dari 2 jaringan lain [server ini + luar Indonesia]
// filenya terbukti baik-baik saja & publik, jadi kemungkinan besar domain r2.dev-nya
// sendiri kena blokir luas di jaringan Indonesia (banyak bucket R2 customer lain berbagi
// subdomain yg sama, gampang ikut kena blokir yg sebenarnya menyasar konten lain).
// Proxy ini TIDAK mempengaruhi alur publish sungguhan (orchestrate.ts publish ke Buffer/
// Meta/YouTube tetap fetch LANGSUNG dari R2 server-to-server, bukan lewat browser Agus,
// jadi tidak kena masalah blokir jaringan ini sama sekali) - ini KHUSUS supaya pratinjau
// draft di browser Agus bisa dibuka lewat domain aimarketing.pelangihomestay.com yang
// sudah terbukti bisa diakses normal.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url wajib diisi" }, { status: 400 });
  }

  // Validasi ketat: HARUS berasal dari storage kita sendiri - cegah proxy ini disalahgunakan
  // jadi open proxy/SSRF ke URL sembarangan.
  const allowedBase = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!allowedBase || !url.startsWith(`${allowedBase}/`)) {
    return NextResponse.json({ error: "URL tidak diizinkan" }, { status: 403 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Gagal ambil media: ${upstream.status}` }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
