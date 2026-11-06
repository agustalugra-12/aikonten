import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { cekRateLimit, catatGagal } from "@/lib/rateLimit";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail, emailResetPassword } from "@/lib/email";

// Reset password mandiri - LANGKAH 1 (2026-11-06, P1.6). Terbitkan token sekali-pakai +
// kedaluwarsa, kirim tautan via email. ANTI-ENUMERASI: selalu balas 200 sama, baik email
// terdaftar atau tidak (jangan bocorkan akun mana yang ada). Rate-limit per IP+email.
const MAKS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const TTL_MENIT = 45;

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email wajib diisi" }, { status: 400 });
  }
  const em = email.trim().toLowerCase();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "ip";
  const key = `forgot:${ip}:${em}`;
  const rl = cekRateLimit(key, MAKS);
  if (rl.blocked) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(rl.retryAfter / 60)} menit.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  catatGagal(key, WINDOW_MS);

  const [user] = await db.select().from(users).where(eq(users.email, em));
  if (user && !user.dihapusAt) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = new Date();
    await db.insert(passwordResetTokens).values({
      id: newId("prt"),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + TTL_MENIT * 60 * 1000),
      usedAt: null,
      createdAt: now,
    });
    const link = `${appBaseUrl()}/reset?token=${token}`;
    try { await sendEmail(emailResetPassword(user.email, link, TTL_MENIT)); } catch {}
  }
  // Balasan SAMA tanpa membocorkan keberadaan akun.
  return NextResponse.json({ ok: true, message: "Jika email terdaftar, tautan reset telah dikirim." });
}
