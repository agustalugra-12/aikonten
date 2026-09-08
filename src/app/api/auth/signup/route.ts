import { NextRequest, NextResponse } from "next/server";
import { hashPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

// Daftar akun baru (2026-09-08, Fase 1 Alur A - "kalau ada yang daftar paket basik maka
// mendapatkan fitur terbatas"). Route ini HANYA bikin akunnya (email+password) -
// SENGAJA TIDAK menyambungkan pembayaran/pemilihan paket apa pun (Agus: "kredensial dan
// lainnya kita sambungkan di akhir saja") - akun baru selalu lahir dengan `planId=null`,
// `saldoKredit=0`. Tanpa planId, `canCreateAnotherBrand()` (session.ts) menolak bikin
// brand pertama dgn pesan jelas "Akun belum punya paket aktif" - jadi akun ada tapi
// benar-benar tidak bisa apa-apa sampai proses pilih-paket+bayar (belum dibangun)
// menempelkan planId & mengisi saldoKredit. Auto-login setelah signup (sama pola dgn
// login/route.ts) supaya alur pilih-paket berikutnya tidak perlu login manual lagi.
export async function POST(req: NextRequest) {
  const { email, password, namaBisnis } = await req.json();
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 });
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
    createdAt: now,
    planId: null,
    status: "aktif",
    saldoKredit: 0,
  });

  const token = await createSessionToken(id);
  const res = NextResponse.json({ ok: true, id }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
