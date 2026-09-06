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

  // Validasi ketat: HARUS berasal dari storage/render kita sendiri - cegah proxy ini
  // disalahgunakan jadi open proxy/SSRF ke URL sembarangan. DUA sumber sah (2026-08-05,
  // bug nyata ditemukan - video draft gagal diputar krn cek sebelumnya CUMA izinkan R2,
  // padahal final_video hasil renderFinalVideo() di-hosting Cloudinary/res.cloudinary.com,
  // bukan R2 - proxy nolak 403 tiap kali video diminta): R2 (foto poster & footage
  // mentah) DAN Cloudinary cloud kita sendiri (video hasil render).
  const r2Base = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "");
  const cloudinaryCloud = process.env.CLOUDINARY_CLOUD_NAME;
  const allowedPrefixes = [
    r2Base ? `${r2Base}/` : null,
    cloudinaryCloud ? `https://res.cloudinary.com/${cloudinaryCloud}/` : null,
  ].filter((p): p is string => !!p);

  if (allowedPrefixes.length === 0 || !allowedPrefixes.some((prefix) => url.startsWith(prefix))) {
    return NextResponse.json({ error: "URL tidak diizinkan" }, { status: 403 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Gagal ambil media: ${upstream.status}` }, { status: 502 });
  }

  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
  };

  // Download poster/foto (2026-09-06, permintaan Agus - "buat fitur download konten
  // foto") - `?download=1` opsional (default TETAP preview inline apa adanya, tidak
  // ubah perilaku lama sama sekali) - browser TIDAK menghormati atribut `<a download>`
  // utk resource CROSS-ORIGIN (R2/Cloudinary, beda domain dari aplikasi ini) - proxy
  // ini SATU-SATUNYA cara paksa download sungguhan (server yg tempel header
  // Content-Disposition: attachment, bukan browser yg menebak dari atribut HTML).
  // Nama file dari query param `filename` (opsional, staf isi biar rapi di folder
  // Download, mis. "poster-agustap-1788683.jpg") - fallback ke nama asli di URL kalau
  // tidak dikirim.
  if (req.nextUrl.searchParams.get("download") === "1") {
    const fallbackName = url.split("/").pop() || "download";
    const filename = req.nextUrl.searchParams.get("filename") || fallbackName;
    headers["Content-Disposition"] = `attachment; filename="${filename.replace(/"/g, "")}"`;
  }

  return new NextResponse(upstream.body, { headers });
}
