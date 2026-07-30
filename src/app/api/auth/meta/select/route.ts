import { NextRequest, NextResponse } from "next/server";
import { takePendingSelection, storePendingSelection, saveMetaAccountsForBrand } from "@/lib/publish/metaAuth";

// Halaman pilih Page - HANYA muncul kalau akun Facebook Agus admin di LEBIH DARI SATU
// Page (mis. Pelangi + Harmoni pakai 1 akun FB pribadi yg sama). Server-rendered HTML
// sederhana, bukan komponen React, krn ini cuma dipakai sesekali & harus jalan bahkan
// tanpa JS/hydration (link biasa, bukan fetch client-side).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const pageId = req.nextUrl.searchParams.get("pageId");
  const appUrl = process.env.APP_URL || req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${appUrl}/?meta_error=missing_token`);
  }

  if (pageId) {
    const pending = takePendingSelection(token);
    if (!pending) {
      return NextResponse.redirect(`${appUrl}/?meta_error=${encodeURIComponent("Sesi pilih Page sudah kadaluarsa, ulangi connect")}`);
    }
    const page = pending.pages.find((p) => p.pageId === pageId);
    if (!page) {
      return NextResponse.redirect(`${appUrl}/?meta_error=invalid_page_selection`);
    }
    const saved = await saveMetaAccountsForBrand(pending.brandId, page);
    return NextResponse.redirect(`${appUrl}/?meta_connected=${encodeURIComponent(saved.join(", "))}`);
  }

  // Tampilkan pilihan (belum ada pageId dipilih) - baca tanpa menghapus, taruh lagi
  // supaya link "pilih" berikutnya (request kedua) masih bisa menemukannya.
  const pending = takePendingSelection(token);
  if (!pending) {
    return NextResponse.redirect(`${appUrl}/?meta_error=${encodeURIComponent("Sesi pilih Page sudah kadaluarsa, ulangi connect")}`);
  }
  storePendingSelection(token, pending.brandId, pending.pages);

  const items = pending.pages
    .map(
      (p) =>
        `<li style="margin-bottom:12px"><a href="/api/auth/meta/select?token=${encodeURIComponent(token)}&pageId=${encodeURIComponent(p.pageId)}" style="padding:8px 14px;border:1px solid #ccc;border-radius:6px;text-decoration:none;color:#111">
          ${p.pageName}${p.igUsername ? ` (+ Instagram @${p.igUsername})` : ""}
        </a></li>`
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pilih Page</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 16px">
<h2>Pilih Facebook Page utk brand ini</h2>
<p style="color:#555">Akun Facebook ini admin di lebih dari satu Page. Pilih salah satu:</p>
<ul style="list-style:none;padding:0">${items}</ul>
</body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
