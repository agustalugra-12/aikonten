import { NextRequest, NextResponse } from "next/server";
import { listBufferChannels } from "@/lib/publish/bufferAuth";

// Buffer TIDAK pakai alur OAuth redirect (beda dari YouTube/Meta) - channel-nya
// disambungkan Agus langsung di dashboard Buffer sendiri, app ini cuma perlu
// menampilkan channel mana saja yg tersedia lewat token Buffer, biar Agus pilih yg mana
// utk brand yg sedang aktif (lihat social-accounts POST route).
//
// `token` query param OPSIONAL (2026-08-06, permintaan Agus - brand "laundry in bali"
// punya akun Buffer sendiri) - kalau diisi, browse channel dari organization token itu;
// kalau tidak, fallback ke BUFFER_ACCESS_TOKEN di .env (perilaku lama, tetap jalan utk
// brand yg pakai akun Buffer bersama/default).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || undefined;
  try {
    const channels = await listBufferChannels(token);
    return NextResponse.json(channels);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
