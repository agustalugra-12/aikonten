import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cekRateLimit, catatGagal, resetRateLimit } from "@/lib/rateLimit";
import { isAdminEmail } from "@/lib/admin";

// Login email+password per-akun. Pesan error SAMA ("Email atau password salah") baik email
// tak ketemu MAUPUN password salah - tak bocorkan email mana yg terdaftar. Rate-limit
// (2026-10-11): maks 5 gagal / 15 menit per IP+email -> 429 (anti brute-force).
const MAKS_GAGAL = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "ip";
  const key = `login:${ip}:${email.trim().toLowerCase()}`;
  const rl = cekRateLimit(key, MAKS_GAGAL);
  if (rl.blocked) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(rl.retryAfter / 60)} menit.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    catatGagal(key, WINDOW_MS);
    return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
  }

  resetRateLimit(key);

  // Admin ber-2FA: JANGAN terbitkan sesi penuh dulu - set cookie pending (bukti password
  // lolos) & minta kode TOTP di /api/auth/2fa. Sesi penuh terbit di sana.
  if (isAdminEmail(user.email) && user.totpEnabled && user.totpSecret) {
    const pending = await createSessionToken(user.id);
    const r = NextResponse.json({ ok: true, need2fa: true });
    r.cookies.set("aikonten_2fa_pending", pending, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300 });
    return r;
  }

  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
