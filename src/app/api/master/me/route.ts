import { NextRequest, NextResponse } from "next/server";
import { getAdminOrNull } from "@/lib/admin";

// Cek cepat apakah sesi saat ini milik admin (2026-09-30). Dipakai halaman /master untuk
// memutuskan tampilkan dashboard atau tolak. Tidak membocorkan apa pun ke non-admin.
export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) {
    return NextResponse.json({ isAdmin: false }, { status: 403 });
  }
  return NextResponse.json({ isAdmin: true, email: admin.email });
}
