// Pengaman auto-publish (feat/publish-guard, 2026-11-04). Fungsi MURNI (tanpa DB) supaya TESTABLE;
// route cron /api/cron/auto-publish memakainya. Cegah: (a) publish konten lama otomatis, (b) burst backlog
// retry / scheduled-telat, (c) satu brand memonopoli satu siklus. Default bisa diatur lewat env.

const H = 60 * 60 * 1000;

export type GuardCfg = {
  retryMaxAgeMs: number;       // konten lebih tua dari ini TIDAK auto-retry (default 72 jam)
  scheduledGraceMs: number;    // scheduled yang telat > ini -> tinjau (bukan terbit) (default 72 jam)
  maxPerBrandPerCycle: number; // max publish per brand per siklus cron (default 3)
  maxTotalPerCycle: number;    // cap total publish per siklus cron (default 10)
};

function numEnv(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// Default + override env. retry/scheduled age default 72 jam (permintaan: konten lama jangan auto-terbit).
export function defaultGuardCfg(env: Record<string, string | undefined> = process.env): GuardCfg {
  return {
    retryMaxAgeMs: numEnv(env.PUBLISH_RETRY_MAX_AGE_HOURS, 72) * H,
    scheduledGraceMs: numEnv(env.PUBLISH_SCHEDULED_GRACE_HOURS, 72) * H,
    maxPerBrandPerCycle: numEnv(env.PUBLISH_MAX_PER_BRAND, 1), // default 1 publish/brand/siklus (anti-burst, hemat Buffer)
    maxTotalPerCycle: numEnv(env.PUBLISH_MAX_TOTAL, 10),
  };
}

export type RetryCand = { id: string; brandId: string; createdAtMs: number; skipAutoPublish: boolean };
export type RetryVerdict = { ok: boolean; reason?: "age" | "skip_flag" };

// Kelayakan retry 1 project (SEBELUM kuota). skip_auto_publish -> dihormati; konten lebih tua dari batas
// usia -> dilewati (tidak auto-terbit konten lama; biar ditinjau/di-"Coba Lagi" manual).
export function retryEligibility(p: RetryCand, nowMs: number, cfg: GuardCfg): RetryVerdict {
  if (p.skipAutoPublish) return { ok: false, reason: "skip_flag" };
  if (nowMs - p.createdAtMs > cfg.retryMaxAgeMs) return { ok: false, reason: "age" };
  return { ok: true };
}

export type SchedCand = { id: string; brandId: string; scheduledForMs: number; skipAutoPublish: boolean };
export type SchedVerdict = { action: "publish" | "review" | "skip_flag" };

// scheduled yang jatuh tempo: masih dalam grace -> publish; telat jauh (> grace) -> TINJAU (jangan burst
// konten basi); skip_auto_publish -> skip. (Route mengkarantina yang telat via skip_auto_publish.)
export function scheduledEligibility(p: SchedCand, nowMs: number, cfg: GuardCfg): SchedVerdict {
  if (p.skipAutoPublish) return { action: "skip_flag" };
  if (nowMs - p.scheduledForMs > cfg.scheduledGraceMs) return { action: "review" };
  return { action: "publish" };
}

// Terapkan kuota per-brand + total ke daftar kandidat TERURUT (prioritas awal diproses lebih dulu).
// Satu id hanya SEKALI (dedup -> tak memproses project yang sama dua kali dalam satu siklus = idempotency
// tingkat-siklus). Return yang dipilih vs dilewati-karena-kuota.
export function applyQuota<T extends { id: string; brandId: string }>(cands: T[], cfg: GuardCfg): { selected: T[]; skippedQuota: T[] } {
  const perBrand = new Map<string, number>();
  const seen = new Set<string>();
  const selected: T[] = [];
  const skippedQuota: T[] = [];
  for (const c of cands) {
    if (seen.has(c.id)) continue; // dedup antar-daftar (partial+failed+scheduled) dalam satu siklus
    seen.add(c.id);
    const n = perBrand.get(c.brandId) ?? 0;
    if (selected.length >= cfg.maxTotalPerCycle || n >= cfg.maxPerBrandPerCycle) { skippedQuota.push(c); continue; }
    perBrand.set(c.brandId, n + 1);
    selected.push(c);
  }
  return { selected, skippedQuota };
}

// === #6 Budget 30 hari (lindungi plan Buffer ~2000/bln). used30d = jumlah call Buffer 30hr (proxy: publish_logs). ===
export type BudgetCfg = { monthly: number; reserve: number };
export function defaultBudgetCfg(env: Record<string, string | undefined> = process.env): BudgetCfg {
  return { monthly: numEnv(env.BUFFER_MONTHLY_BUDGET, 2000), reserve: numEnv(env.BUFFER_BUDGET_RESERVE, 150) };
}
export type BudgetVerdict = { remaining: number; allowNewPublish: boolean; allowRetry: boolean; allowNonEssential: boolean };
// Prioritas: publish BARU jalan selama masih ada sisa; retry & call nonesensial (analytics/verify) BERHENTI
// begitu sisa <= reserve -> sisakan anggaran utk konten baru, bukan dihabiskan retry/analytics.
export function budgetVerdict(used30d: number, cfg: BudgetCfg): BudgetVerdict {
  const remaining = cfg.monthly - used30d;
  return { remaining, allowNewPublish: remaining > 0, allowRetry: remaining > cfg.reserve, allowNonEssential: remaining > cfg.reserve };
}

// === #8 Circuit breaker: token invalid / rate limit -> hentikan siklus + cooldown. ===
export type BreakerReason = "token_invalid" | "rate_limit";
export function classifyBufferError(message: string | null | undefined): BreakerReason | null {
  const m = String(message || "").toLowerCase();
  if (/unauthenticated|access token is not valid|invalid.*token|token.*invalid/.test(m)) return "token_invalid";
  if (/too many requests|rate.?limit|\b429\b/.test(m)) return "rate_limit";
  return null;
}
export type CooldownCfg = { tokenInvalidMs: number; rateLimitMs: number };
export function defaultCooldownCfg(env: Record<string, string | undefined> = process.env): CooldownCfg {
  return { tokenInvalidMs: numEnv(env.BUFFER_TOKEN_COOLDOWN_HOURS, 6) * H, rateLimitMs: numEnv(env.BUFFER_RATELIMIT_COOLDOWN_HOURS, 1) * H };
}
export function cooldownForReason(r: BreakerReason, cfg: CooldownCfg): number {
  return r === "token_invalid" ? cfg.tokenInvalidMs : cfg.rateLimitMs;
}
export function isInCooldown(cooldownUntilMs: number | null | undefined, nowMs: number): boolean {
  return cooldownUntilMs != null && nowMs < cooldownUntilMs;
}

// === #7 Kuota HARIAN per brand/akun (di atas kuota siklus). count24h dari publish_logs sukses 24 jam. ===
export type DailyCfg = { maxPerBrandPerDay: number; maxPerAccountPerDay: number };
// Diselaraskan dgn kuota BULANAN 20/brand (#3): default harian 5 (≈ sebar 20/bln tanpa burst 1 hari).
export function defaultDailyCfg(env: Record<string, string | undefined> = process.env): DailyCfg {
  return { maxPerBrandPerDay: numEnv(env.PUBLISH_MAX_PER_BRAND_DAY, 5), maxPerAccountPerDay: numEnv(env.PUBLISH_MAX_PER_ACCOUNT_DAY, 5) };
}
export function dailyBrandExceeded(brandCount24h: number, cfg: DailyCfg): boolean { return brandCount24h >= cfg.maxPerBrandPerDay; }

// #3 Kuota BULANAN per brand (ceiling di atas harian). Default 20 publish/brand/30hr (PUBLISH_MAX_PER_BRAND_MONTH).
export type MonthlyCfg = { maxPerBrandPerMonth: number };
export function defaultMonthlyCfg(env: Record<string, string | undefined> = process.env): MonthlyCfg {
  return { maxPerBrandPerMonth: numEnv(env.PUBLISH_MAX_PER_BRAND_MONTH, 20) };
}
export function monthlyBrandExceeded(brandSuccess30d: number, cfg: MonthlyCfg): boolean { return brandSuccess30d >= cfg.maxPerBrandPerMonth; }

// === #8 Jalankan siklus publish TERURUT; berhenti SEGERA pada breaker (token/rate), jangan coba kandidat lain. ===
export type PublishOutcome = { ok: boolean; bufferError?: string | null };
export async function runPublishCycle(
  ordered: Array<{ id: string; brandId: string }>,
  publishFn: (id: string) => Promise<PublishOutcome>,
  opts: { nowMs: number; cooldownCfg: CooldownCfg },
): Promise<{ published: string[]; failed: string[]; halted: BreakerReason | null; haltedAt: string | null; cooldownUntilMs: number | null }> {
  const published: string[] = [];
  const failed: string[] = [];
  for (const c of ordered) {
    const out = await publishFn(c.id);
    if (out.ok) { published.push(c.id); continue; }
    const reason = classifyBufferError(out.bufferError);
    if (reason) {
      // Circuit breaker: hentikan SELURUH siklus + pasang cooldown; JANGAN coba konten/akun lain.
      return { published, failed, halted: reason, haltedAt: c.id, cooldownUntilMs: opts.nowMs + cooldownForReason(reason, opts.cooldownCfg) };
    }
    failed.push(c.id); // gagal non-breaker (mis. media hilang) -> catat, lanjut kandidat lain
  }
  return { published, failed, halted: null, haltedAt: null, cooldownUntilMs: null };
}
