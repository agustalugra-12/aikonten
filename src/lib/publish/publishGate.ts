// Gate publish per brand -> per TOKEN Buffer (feat/publish-guard). Menggantikan budget dari publish_logs dan
// cooldown global in-memory. Sumber: ledger (countCalls30d) + buffer_token_state (cooldown persisten) +
// kuota publish harian/bulanan per brand. Keputusan murni ada di guard.ts.
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { projects, publishLogs, socialAccounts } from "@/db/schema";
import { countCalls30d, getTokenCooldownUntil, setTokenCooldown, tokenFingerprint } from "./ledger";
import { budgetVerdict, cooldownForReason, dailyBrandExceeded, defaultBudgetCfg, defaultDailyCfg, defaultMonthlyCfg, monthlyBrandExceeded, type BreakerReason, type CooldownCfg } from "./guard";

export type BrandGate = {
  brandId: string;
  allowNew: boolean;
  allowRetry: boolean;
  reason: "cooldown" | "budget_exhausted" | "budget_reserve" | "daily_quota" | "monthly_quota" | null;
  tokens: Array<{ fp: string; used30d: number; cooldownUntil: number | null }>;
  published24h: number;
  published30d: number;
};

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

export async function evaluateBrandGate(brandId: string, nowMs: number): Promise<BrandGate> {
  const g: BrandGate = { brandId, allowNew: true, allowRetry: true, reason: null, tokens: [], published24h: 0, published30d: 0 };
  const budgetCfg = defaultBudgetCfg();
  for (const token of await brandBufferTokens(brandId)) {
    const cooldownUntil = await getTokenCooldownUntil(token, nowMs);
    const used30d = await countCalls30d(token, nowMs);
    g.tokens.push({ fp: tokenFingerprint(token), used30d, cooldownUntil });
    if (cooldownUntil) { g.allowNew = g.allowRetry = false; g.reason = "cooldown"; continue; }
    const v = budgetVerdict(used30d, budgetCfg);
    if (!v.allowNewPublish) { g.allowNew = g.allowRetry = false; g.reason ??= "budget_exhausted"; }
    else if (!v.allowRetry) { g.allowRetry = false; g.reason ??= "budget_reserve"; } // publish baru tetap prioritas
  }
  g.published24h = await distinctPublishedProjects(brandId, new Date(nowMs - 24 * 3600_000));
  g.published30d = await distinctPublishedProjects(brandId, new Date(nowMs - 30 * 24 * 3600_000));
  if (monthlyBrandExceeded(g.published30d, defaultMonthlyCfg())) { g.allowNew = g.allowRetry = false; g.reason ??= "monthly_quota"; }
  else if (dailyBrandExceeded(g.published24h, defaultDailyCfg())) { g.allowNew = g.allowRetry = false; g.reason ??= "daily_quota"; }
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
