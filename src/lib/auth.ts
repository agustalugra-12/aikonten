import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

// Multi-tenant auth (2026-09-07, fork dari KontenPilot internal untuk produk SaaS
// aikonten.agustapstudio.com - PRD "AI Konten by Agustap Studio", Fase 1). Repo ASAL
// (internal) tetap single-admin (1 ADMIN_PASSWORD_HASH_B64 di .env, lihat versi lama
// file ini) - fork INI ganti total ke sesi per-akun sungguhan: JWT menyimpan userId,
// password diverifikasi per-baris `users.passwordHash` (bukan 1 hash global).
const SESSION_COOKIE = "aikonten_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 hari

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum diisi di .env");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Sesi berisi userId (BUKAN cuma role:"admin" spt versi lama) - inilah yang membuat
// middleware.ts & tiap route API tahu PERSIS akun mana yang sedang login, dasar dari
// seluruh isolasi antar-pelanggan (Alur D, PRD Fase 1).
export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

// Balikin userId kalau token valid, null kalau tidak (kadaluarsa/rusak/dipalsukan) -
// BEDA dari versi lama yang cuma balikin boolean, krn sekarang perlu tahu SIAPA yang
// login, bukan cuma "apakah ada yang login".
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
