import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";
import { generateSecret, otpauthUri, verifyTotp } from "@/lib/totp";

// Kelola 2FA admin dari Master (2026-10-23). GET=status. POST {action}:
//  setup  -> buat secret baru (enabled tetap false sampai dikonfirmasi), balikin secret+uri.
//  enable -> {code} verifikasi 1x utk pastikan authenticator benar -> enabled=true.
//  disable-> {code} verifikasi -> hapus secret + enabled=false.
export async function GET(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const [u] = await db.select().from(users).where(eq(users.id, admin.userId));
  return NextResponse.json({ enabled: !!u?.totpEnabled, setupPending: !!u?.totpSecret && !u?.totpEnabled });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const { action, code } = await req.json().catch(() => ({}));
  const [u] = await db.select().from(users).where(eq(users.id, admin.userId));
  if (!u) return NextResponse.json({ error: "Akun tidak ditemukan" }, { status: 404 });

  if (action === "setup") {
    if (u.totpEnabled) return NextResponse.json({ error: "2FA sudah aktif" }, { status: 400 });
    const secret = generateSecret();
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, u.id));
    return NextResponse.json({ secret, uri: otpauthUri(u.email, secret) });
  }
  if (action === "enable") {
    if (!u.totpSecret) return NextResponse.json({ error: "Jalankan setup dulu" }, { status: 400 });
    if (!verifyTotp(u.totpSecret, String(code ?? ""))) return NextResponse.json({ error: "Kode salah" }, { status: 400 });
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, u.id));
    return NextResponse.json({ ok: true, enabled: true });
  }
  if (action === "disable") {
    if (!u.totpEnabled || !u.totpSecret) return NextResponse.json({ error: "2FA belum aktif" }, { status: 400 });
    if (!verifyTotp(u.totpSecret, String(code ?? ""))) return NextResponse.json({ error: "Kode salah" }, { status: 400 });
    await db.update(users).set({ totpEnabled: false, totpSecret: null }).where(eq(users.id, u.id));
    return NextResponse.json({ ok: true, enabled: false });
  }
  return NextResponse.json({ error: "action tidak dikenal" }, { status: 400 });
}
