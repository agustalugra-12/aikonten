// Ledger persisten call Buffer + state breaker per token (feat/publish-guard, 2026-11-04). DB tipis;
// LOGIKA keputusan tetap murni di guard.ts (budgetVerdict/isInCooldown) -> testable tanpa DB.
import { createHash } from "node:crypto";
import { and, eq, gte, count } from "drizzle-orm";
import { db } from "@/db";
import { bufferCallLedger, bufferTokenState } from "@/db/schema";
import { newId } from "@/lib/ids";

export type BufferCallKind = "createPost" | "sweep" | "analytics" | "channels" | "tokenCheck" | "delete";

// Fingerprint token: HASH stabil (JANGAN simpan/t tampilkan token mentah). Token kosong -> "env" (token global).
export function tokenFingerprint(token: string | null | undefined): string {
  return createHash("sha256").update(token && token.trim() ? token.trim() : "env").digest("hex").slice(0, 16);
}

// Tulis 1 baris ledger per call Buffer. best-effort: kegagalan ledger TIDAK boleh menggagalkan publish.
export async function recordBufferCall(kind: BufferCallKind, token: string | null | undefined, brandId: string | null, channelId: string | null, nowMs: number): Promise<void> {
  try {
    await db.insert(bufferCallLedger).values({ id: newId("bcl"), tokenFp: tokenFingerprint(token), brandId, channelId, kind, createdAt: new Date(nowMs) });
  } catch (e) {
    console.error("[ledger] gagal catat call Buffer (diabaikan):", String((e as Error)?.message || e));
  }
}

// Hitung call 30 hari per TOKEN (dari ledger, bukan publish_logs). Isolasi token: hanya tokenFp ini.
export async function countCalls30d(token: string | null | undefined, nowMs: number): Promise<number> {
  const since = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const [row] = await db.select({ c: count() }).from(bufferCallLedger).where(and(eq(bufferCallLedger.tokenFp, tokenFingerprint(token)), gte(bufferCallLedger.createdAt, since)));
  return row?.c ?? 0;
}

// Cooldown/breaker PERSISTEN per token (tahan restart). Baca epoch cooldownUntil (ms) atau null.
export async function getTokenCooldownUntil(token: string | null | undefined, nowMs: number): Promise<number | null> {
  const [row] = await db.select().from(bufferTokenState).where(eq(bufferTokenState.tokenFp, tokenFingerprint(token)));
  if (!row || !row.cooldownUntil) return null;
  const until = new Date(row.cooldownUntil).getTime();
  return until > nowMs ? until : null; // kadaluarsa -> anggap tak ada cooldown
}

// Pasang cooldown per token (upsert). reason = token_invalid | rate_limit.
export async function setTokenCooldown(token: string | null | undefined, untilMs: number, reason: string, nowMs: number): Promise<void> {
  const tokenFp = tokenFingerprint(token);
  const existing = await db.select({ tokenFp: bufferTokenState.tokenFp }).from(bufferTokenState).where(eq(bufferTokenState.tokenFp, tokenFp));
  if (existing.length) {
    await db.update(bufferTokenState).set({ cooldownUntil: new Date(untilMs), reason, updatedAt: new Date(nowMs) }).where(eq(bufferTokenState.tokenFp, tokenFp));
  } else {
    await db.insert(bufferTokenState).values({ tokenFp, cooldownUntil: new Date(untilMs), reason, updatedAt: new Date(nowMs) });
  }
}
