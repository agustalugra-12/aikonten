// Gate publish per brand -> per TOKEN Buffer (feat/publish-guard).
// Aturan bisnis (keputusan 2026-11-04):
//  - Pelanggan EKSTERNAL dibatasi kredit paket saat GENERATE. Publish TIDAK memotong kredit & TIDAK punya kuota
//    harian/bulanan bisnis.
//  - Brand INTERNAL (owner users.unlimited) memakai kuota harian PUBLISH_MAX_PER_BRAND_DAY (default 20).
//  - SEMUA brand memakai perlindungan TEKNIS: budget Buffer 2000 call/token/30hr (ledger), cooldown persisten,
//    breaker, anti-burst per siklus. Budget token habis = publish DITAHAN dgn alasan teknis (bukan kuota paket).
// Internal/eksternal ditentukan dari akun OWNER (users.unlimited), TIDAK dari nama brand.
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { brands, projects, publishLogs, socialAccounts, users } from "@/db/schema";
import { countCalls30d, getTokenCooldownUntil, setTokenCooldown, tokenFingerprint } from "./ledger";
import { budgetVerdict, cooldownForReason, dailyBrandExceeded, defaultBudgetCfg, defaultDailyCfg, windowStartMs, type BreakerReason, type CooldownCfg } from "./guard";

export type GateReason = "token_cooldown" | "token_budget_exhausted" | "token_budget_reserve" | "internal_daily_quota";
export type BrandGate = {
  brandId: string;
  internal: boolean;
  allowNew: boolean;
  allowRetry: boolean;
  reason: GateReason | null;
  message: string | null; // alasan utk ditampilkan (bukan "kuota paket"; kredit tidak dipotong)
  tokens: Array<{ fp: string; used30d: number; remaining: number; cooldownUntil: number | null }>;
  publishedToday: number | null; // null = eksternal (tak dihitung kuota harian)
};

export const GATE_MESSAGES: Record<GateReason, string> = {
  token_cooldown: "Publish ditahan: token Buffer sedang cooldown (token tidak valid / rate limit). Bukan kuota paket; kredit tidak dipotong.",
  token_budget_exhausted: "Publish ditahan: budget teknis Buffer token ini habis (2000 call/30 hari). Bukan kuota paket; kredit tidak dipotong, akan lanjut otomatis saat budget pulih.",
  token_budget_reserve: "Retry/analytics ditahan: budget teknis Buffer token tinggal cadangan; publish baru tetap diprioritaskan. Bukan kuota paket.",
  internal_daily_quota: "Publish ditahan: kuota harian brand internal tercapai (PUBLISH_MAX_PER_BRAND_DAY).",
};

// Brand internal = owner akun unlimited (konvensi sama dgn aturanProduk.ts).
export async function isInternalBrand(brandId: string): Promise<boolean> {
  const [row] = await db.select({ unlimited: users.unlimited }).from(brands).innerJoin(users, eq(users.id, brands.userId)).where(eq(brands.id, brandId));
  return !!row?.unlimited;
}

// Token Buffer yang dipakai brand (akun connected via buffer). null = pakai env BUFFER_ACCESS_TOKEN.
export async function brandBufferTokens(brandId: string): Promise<Array<string | null>> {
  const accs = await db.select({ token: socialAccounts.accessToken, via: socialAccounts.publishVia }).from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.connected, true)));
  const byFp = new Map<string, string | null>();
  for (const a of accs) if (a.via === "buffer") byFp.set(tokenFingerprint(a.token), a.token ?? null);
  return [...byFp.values()];
}

async function distinctPublishedProjects(brandId: string, since: Date): Promise<number> {
  const rows = await db.select({ pid: publishLogs.projectId }).from(publishLogs).innerJoin(projects, eq(projects.id, publishLogs.projectId))
    .where(and(eq(projects.brandId, brandId), eq(publishLogs.status, "success"), gte(publishLogs.createdAt, since)));
  return new Set(rows.map((r) => r.pid)).size;
}

// Verdict teknis satu token (dipakai gate publish, sweep, analytics).
export async function tokenVerdict(token: string | null | undefined, nowMs: number) {
  const cooldownUntil = await getTokenCooldownUntil(token, nowMs);
  const used30d = await countCalls30d(token, nowMs);
  const v = budgetVerdict(used30d, defaultBudgetCfg());
  return { fp: tokenFingerprint(token), cooldownUntil, used30d, ...v };
}

export async function evaluateBrandGate(brandId: string, nowMs: number): Promise<BrandGate> {
  const internal = await isInternalBrand(brandId);
  const g: BrandGate = { brandId, internal, allowNew: true, allowRetry: true, reason: null, message: null, tokens: [], publishedToday: null };
  const hold = (r: GateReason, newToo: boolean) => { if (newToo) g.allowNew = false; g.allowRetry = false; g.reason ??= r; };
  for (const token of await brandBufferTokens(brandId)) {
    const t = await tokenVerdict(token, nowMs);
    g.tokens.push({ fp: t.fp, used30d: t.used30d, remaining: t.remaining, cooldownUntil: t.cooldownUntil });
    if (t.cooldownUntil) hold("token_cooldown", true);
    else if (!t.allowNewPublish) hold("token_budget_exhausted", true);
    else if (!t.allowRetry) hold("token_budget_reserve", false); // publish baru tetap prioritas
  }
  if (internal) {
    g.publishedToday = await distinctPublishedProjects(brandId, new Date(windowStartMs(nowMs, 24 * 3600_000)));
    if (dailyBrandExceeded(g.publishedToday, defaultDailyCfg())) hold("internal_daily_quota", true);
  }
  g.message = g.reason ? GATE_MESSAGES[g.reason] : null;
  return g;
}

// Cache per putaran cron (1 evaluasi per brand per siklus).
export function makeGateCache(nowMs: number): (brandId: string) => Promise<BrandGate> {
  const cache = new Map<string, Promise<BrandGate>>();
  return (brandId) => {
    if (!cache.has(brandId)) cache.set(brandId, evaluateBrandGate(brandId, nowMs));
    return cache.get(brandId)!;
  };
}

// Breaker: pasang cooldown PERSISTEN hanya pada token akun yang gagal (log gagal terbaru project itu).
export async function tripBreakerForProject(projectId: string, reason: BreakerReason, nowMs: number, cfg: CooldownCfg): Promise<string | null> {
  const [log] = await db.select({ acc: publishLogs.socialAccountId }).from(publishLogs)
    .where(and(eq(publishLogs.projectId, projectId), eq(publishLogs.status, "failed"))).orderBy(desc(publishLogs.createdAt)).limit(1);
  if (!log) return null;
  const [acc] = await db.select({ token: socialAccounts.accessToken, via: socialAccounts.publishVia }).from(socialAccounts).where(eq(socialAccounts.id, log.acc));
  if (!acc || acc.via !== "buffer") return null;
  await setTokenCooldown(acc.token ?? null, nowMs + cooldownForReason(reason, cfg), reason, nowMs);
  return tokenFingerprint(acc.token ?? null);
}
