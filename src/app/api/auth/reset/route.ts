import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { cekRateLimit, catatGagal } from "@/lib/rateLimit";

// Reset password mandiri - LANGKAH 2 (2026-11-06, P1.6). Konsumsi token: validasi hash +
// belum terpakai + belum kedaluwarsa, lalu set password baru & tandai token terpakai (sekali
// pakai) dalam SATU transaksi. Rate-limit per IP (anti tebak token brute-force).
const MAKS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { token, password } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Token tidak valid atau password minimal 8 karakter." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "ip";
  const key = `reset:${ip}`;
  const rl = cekRateLimit(key, MAKS);
  if (rl.blocked) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(rl.retryAfter / 60)} menit.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  catatGagal(key, WINDOW_MS);

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
  const now = new Date();
  if (!row || row.usedAt || row.expiresAt.getTime() < now.getTime()) {
    return NextResponse.json({ error: "Tautan reset tidak valid atau sudah kedaluwarsa. Minta ulang." }, { status: 400 });
  }

  const hash = await hashPassword(password); // bcrypt async - DI LUAR transaksi (tx sinkron).
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash: hash }).where(eq(users.id, row.userId)).run();
    tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, row.id)).run();
  });

  return NextResponse.json({ ok: true, message: "Password berhasil diubah. Silakan masuk." });
}
