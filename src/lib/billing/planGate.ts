import { db } from "@/db";
import { users, plans } from "@/db/schema";
import { eq } from "drizzle-orm";

// Gate fitur berbasis paket (2026-09-08, Fase 1 - PRD "AI Konten by Agustap Studio":
// "beberapa paket yang langsung auto posting... dan tanpa auto posting"). Beda dari
// billing/credits.ts (JUMLAH pemakaian) - ini soal FITUR mana yang diizinkan sama sekali
// utk paket akun ini, terlepas dari saldo kredit.
export async function planMengizinkanAutoPosting(userId: string): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.planId) return false; // belum punya paket aktif = fitur paling terbatas
  const [plan] = await db.select().from(plans).where(eq(plans.id, user.planId));
  return plan?.izinAutoPosting ?? false;
}
