import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Gerbang admin/owner untuk Master Dashboard (2026-09-30, permintaan Agus - "master
// dasbord yang bisa memantau berapa konsumen jenis paket, mana yang tidak berlangganan
// mana yang lanjut"). Fork multi-tenant SENGAJA menghapus konsep admin (lihat auth.ts) &
// setiap akun cuma bisa lihat datanya sendiri - jadi master dashboard butuh mekanisme
// admin BARU. Dipilih pendekatan allowlist email di .env (paling simpel, tanpa migrasi
// DB): admin = akun yang email-nya terdaftar di ADMIN_EMAILS. Kalau nanti mau tambah
// admin lain, cukup tambahkan email-nya di .env & restart - tidak perlu deploy/migrasi.
//
// Format .env: ADMIN_EMAILS=agus.lugra@gmail.com,partner@contoh.com (dipisah koma).

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
}

// Verifikasi bahwa request datang dari akun admin. Dipakai route /api/master/* (yang
// SENGAJA dikecualikan proxy dari injeksi x-user-id supaya kita verifikasi sesi + status
// admin SEKALIGUS di sini, bukan mengandalkan header saja). Balikin { userId, email }
// kalau admin, atau null kalau bukan/tidak login - pemanggil WAJIB balas 403 (bukan 404,
// beda dari isolasi tenant biasa: di sini kita justru mau tegas "kamu bukan admin").
export async function getAdminOrNull(
  req: NextRequest,
): Promise<{ userId: string; email: string } | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  if (!isAdminEmail(user.email)) return null;

  return { userId: user.id, email: user.email };
}
