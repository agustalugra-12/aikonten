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
    maxPerBrandPerCycle: numEnv(env.PUBLISH_MAX_PER_BRAND, 3),
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
// konten basi); skip_auto_publish -> skip. (Dipakai route utk set status "needs_review" bagi yg telat.)
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
