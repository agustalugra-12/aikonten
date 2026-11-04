// Ledger persisten call Buffer + state breaker per token (feat/publish-guard, 2026-11-04). DB tipis;
// LOGIKA keputusan tetap murni di guard.ts (budgetVerdict/isInCooldown) -> testable tanpa DB.
import { createHash } from "node:crypto";
import { and, eq, gte, count } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { bufferCallLedger, bufferTokenState } from "@/db/schema";
import { newId } from "@/lib/ids";
import { LEDGER_TABLES } from "./ledgerSchema";
import { windowStartMs } from "./guard";

export type BufferCallKind = "createPost" | "duplicateCheck" | "verify" | "sweep" | "analytics" | "channels" | "tokenCheck" | "delete";

// Fingerprint dari token yang BENAR-BENAR dipakai (akun tanpa token sendiri = BUFFER_ACCESS_TOKEN env), supaya
// gate, ledger, dan cooldown selalu sepakat untuk token yang sama. Hash -> token mentah tak pernah disimpan.
// Rotasi token env => fingerprint baru => budget mulai bersih (baseline alami, log gagal lama tak ikut).
export function resolveBufferTokenValue(token: string | null | undefined): string {
  return (token && token.trim()) || process.env.BUFFER_ACCESS_TOKEN || "";
}
export function tokenFingerprint(token: string | null | undefined): string {
  return createHash("sha256").update(resolveBufferTokenValue(token) || "no-token").digest("hex").slice(0, 16);
}

// #8 Deploy aman: tabel ledger belum dimigrasi -> publish BERHENTI dengan error jelas (bukan diam-diam budget=0).
export class LedgerNotReadyError extends Error {
  constructor(missing: string[]) {
    super(`LEDGER_NOT_MIGRATED: tabel ${missing.join(", ")} belum ada. Jalankan scripts/migrate-publish-ledger.ts (backup -> migrate -> build -> restart). Publish dihentikan.`);
    this.name = "LedgerNotReadyError";
  }
}
let ledgerReadyCache = false; // hanya cache hasil POSITIF (sekali ada, tabel tak hilang); negatif dicek ulang.
export function missingLedgerTables(): string[] {
  const rows = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${LEDGER_TABLES.map(() => "?").join(",")})`).all(...LEDGER_TABLES) as { name: string }[];
  const have = new Set(rows.map((r) => r.name));
  return LEDGER_TABLES.filter((t) => !have.has(t));
}
export function ledgerReady(): boolean {
  if (ledgerReadyCache) return true;
  ledgerReadyCache = missingLedgerTables().length === 0;
  return ledgerReadyCache;
}
export function assertLedgerReady(): void {
  if (!ledgerReady()) throw new LedgerNotReadyError(missingLedgerTables());
}

// Tulis 1 baris ledger per call Buffer (dipanggil SEBELUM fetch -> percobaan yang gagal pun terhitung).
// best-effort: kegagalan ledger tidak menggagalkan call (gate publish sudah memastikan tabel ada).
export async function recordBufferCall(kind: BufferCallKind, token: string | null | undefined, brandId: string | null, channelId: string | null, nowMs: number): Promise<void> {
  try {
    await db.insert(bufferCallLedger).values({ id: newId("bcl"), tokenFp: tokenFingerprint(token), brandId, channelId, kind, createdAt: new Date(nowMs) });
  } catch (e) {
    console.error("[ledger] gagal catat call Buffer (diabaikan):", String((e as Error)?.message || e));
  }
}

// Hitung call 30 hari per TOKEN (dari ledger, bukan publish_logs). Isolasi token: hanya tokenFp ini.
export async function countCalls30d(token: string | null | undefined, nowMs: number): Promise<number> {
  // Baseline teknis: window 30 hari, dipotong PUBLISH_QUOTA_START_AT bila di-set.
  const since = new Date(windowStartMs(nowMs, 30 * 24 * 60 * 60 * 1000));
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
