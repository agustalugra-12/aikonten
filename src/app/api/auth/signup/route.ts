import { NextRequest, NextResponse } from "next/server";
import { hashPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { cekRateLimit, catatGagal } from "@/lib/rateLimit";

// Daftar akun baru (akun lahir planId=null -> tak bisa apa2 sampai pilih-paket+bayar).
// Auto-login setelah signup. 2026-10-11: + rate-limit (anti spam akun massal), + wajib
// setuju S&K (rekam setuju_at utk perlindungan hukum), + simpan nama/nomor_wa + validasi email.
const MAKS_SIGNUP = 5;              // maks akun per IP
const WINDOW_MS = 60 * 60 * 1000;  // per 60 menit

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "ip";
  const rlKey = `signup:${ip}`;
  const rl = cekRateLimit(rlKey, MAKS_SIGNUP);
  if (rl.blocked) {
    return NextResponse.json(
      { error: `Terlalu banyak pendaftaran dari jaringan ini. Coba lagi dalam ${Math.ceil(rl.retryAfter / 60)} menit.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  catatGagal(rlKey, WINDOW_MS);

  const { email, password, namaBisnis, nama, nomorWa, setuju } = await req.json();
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
  }
  if (setuju !== true) {
    return NextResponse.json({ error: "Kamu harus menyetujui Syarat & Ketentuan dan Kebijakan Privasi" }, { status: 400 });
  }
  const emailNorm = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, emailNorm));
  if (existing) {
    return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const id = newId("user");
  const now = new Date();
  await db.insert(users).values({
    id,
    email: emailNorm,
    passwordHash,
    namaBisnis: typeof namaBisnis === "string" && namaBisnis.trim() ? namaBisnis.trim() : null,
    nama: typeof nama === "string" && nama.trim() ? nama.trim() : null,
    nomorWa: typeof nomorWa === "string" && nomorWa.trim() ? nomorWa.trim() : null,
    setujuAt: Math.floor(Date.now() / 1000),
    createdAt: now,
    planId: null,
    status: "aktif",
    saldoKredit: 0,
  });

  const token = await createSessionToken(id);
  const res = NextResponse.json({ ok: true, id }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
