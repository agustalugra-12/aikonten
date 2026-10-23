import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, verifySessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyTotp } from "@/lib/totp";
import { cekRateLimit, catatGagal, resetRateLimit } from "@/lib/rateLimit";

const PENDING_COOKIE = "aikonten_2fa_pending";
const MAKS_GAGAL = 5;
const WINDOW_MS = 10 * 60 * 1000;

// Langkah-2 login untuk admin ber-2FA (2026-10-23). Sesi PENUH hanya terbit di sini setelah
// kode TOTP benar; cookie pending (dibuat di /api/auth/login) membuktikan password sudah lolos.
export async function POST(req: NextRequest) {
  const pending = req.cookies.get(PENDING_COOKIE)?.value;
  const userId = pending ? await verifySessionToken(pending) : null;
  if (!userId) return NextResponse.json({ error: "Sesi 2FA kadaluarsa, login ulang" }, { status: 401 });

  const { code } = await req.json().catch(() => ({}));
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "ip";
  const key = `2fa:${ip}:${userId}`;
  const rl = cekRateLimit(key, MAKS_GAGAL);
  if (rl.blocked) {
    return NextResponse.json({ error: `Terlalu banyak percobaan. Coba lagi ${Math.ceil(rl.retryAfter / 60)} menit.` }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.totpEnabled || !user.totpSecret || !verifyTotp(user.totpSecret, String(code ?? ""))) {
    catatGagal(key, WINDOW_MS);
    return NextResponse.json({ error: "Kode 2FA salah" }, { status: 401 });
  }

  resetRateLimit(key);
  const token = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  res.cookies.set(PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
