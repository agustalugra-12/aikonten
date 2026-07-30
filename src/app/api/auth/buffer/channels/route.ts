import { NextResponse } from "next/server";
import { listBufferChannels } from "@/lib/publish/bufferAuth";

// Buffer TIDAK pakai alur OAuth redirect (beda dari YouTube/Meta) - channel-nya
// disambungkan Agus langsung di dashboard Buffer sendiri, app ini cuma perlu
// menampilkan channel mana saja yg tersedia lewat BUFFER_ACCESS_TOKEN, biar Agus pilih
// yg mana utk brand yg sedang aktif (lihat social-accounts POST route).
export async function GET() {
  try {
    const channels = await listBufferChannels();
    return NextResponse.json(channels);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
