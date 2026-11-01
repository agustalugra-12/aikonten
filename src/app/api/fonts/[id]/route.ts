import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { resolveFont, isFontFamilyId } from "@/lib/render/fontRegistry";

// Sajikan file .ttf font KURASI sbg webfont utk PREVIEW di browser (T4 2026-11-02, Brand Kit
// "perlihatkan font pop-in"). Hanya id font kurasi (isFontFamilyId) -> resolveFont.fileAbsolute
// (tak pernah terima path mentah dari user, cegah traversal). Aset OFL publik, read-only.
// Berada di /api (butuh sesi via proxy) - cukup, preview cuma dibuka user login di dashboard.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isFontFamilyId(id)) {
    return NextResponse.json({ error: "font tidak dikenal" }, { status: 404 });
  }
  const font = resolveFont(id, "regular");
  try {
    const buf = await readFile(font.fileAbsolute);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "font tidak tersedia" }, { status: 404 });
  }
}
