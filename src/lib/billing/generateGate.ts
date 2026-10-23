import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cekRateLimit, catatGagal } from "@/lib/rateLimit";

// Rate-limit generate MANUAL per tenant (Fase 0-B, 2026-10-23). Lindungi API key AI BERSAMA
// dari rapid-fire dalam kuota kredit (kredit tetap batas utama; ini cegah burst/DoS ringan).
// Akun `unlimited` (brand internal) DIKECUALIKAN. Jalur CRON tidak memanggil ini (ia panggil
// runAutoContent/processProject langsung) → otomatis bebas limit. Balikin {blocked, retryAfter}
// (pola early-return, TIDAK melempar — biar tak mengganggu try/catch refund kredit yg sudah ada).
const MAKS = 20;                     // maks generate manual
const WINDOW_MS = 5 * 60 * 1000;     // per 5 menit per tenant

export async function gateGenerateManual(userId: string): Promise<{ blocked: boolean; retryAfter: number }> {
  const [u] = await db.select({ unlimited: users.unlimited }).from(users).where(eq(users.id, userId));
  if (u?.unlimited) return { blocked: false, retryAfter: 0 };
  const key = `aigen:${userId}`;
  const rl = cekRateLimit(key, MAKS);
  if (rl.blocked) return { blocked: true, retryAfter: rl.retryAfter };
  catatGagal(key, WINDOW_MS); // util generik: menambah hitungan dalam window
  return { blocked: false, retryAfter: 0 };
}
