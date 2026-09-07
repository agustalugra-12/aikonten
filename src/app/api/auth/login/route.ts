import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// Login email+password per-akun (2026-09-07, ganti dari verifyAdminPassword 1-password
// global - lihat auth.ts). Pesan error SAMA ("Email atau password salah") baik email
// tidak ketemu MAUPUN password salah - jangan bocorkan email mana yang terdaftar.
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi" }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user) {
    return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
  }

  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
