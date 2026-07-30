import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

// Single-admin auth only (Agus is the only user) - no multi-provider OAuth, no signup
// flow. Password hash + session secret come from env, set once during deploy.
const SESSION_COOKIE = "kontenpilot_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 hari

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum diisi di .env");
  return new TextEncoder().encode(secret);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  // Hash disimpan sbg base64 di .env (ADMIN_PASSWORD_HASH_B64), BUKAN string bcrypt
  // mentah - lihat scripts/hash-password.mjs utk alasan (bug ekspansi "$VAR" Next.js
  // pada value .env yang mengandung "$", yang selalu ada di hash bcrypt).
  const encoded = process.env.ADMIN_PASSWORD_HASH_B64;
  if (!encoded) throw new Error("ADMIN_PASSWORD_HASH_B64 belum diisi di .env");
  const hash = Buffer.from(encoded, "base64").toString("utf-8");
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSessionSecret());
    return true;
  } catch {
    return false;
  }
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
