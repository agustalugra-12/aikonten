// Cache dashboard analitik Buffer - dipisah dari route biar TESTABLE & satu sumber angka.
// feat/buffer-quota-saver (2026-11-06): 12 jam -> 24 jam. Alasan: metrik Buffer tak
// real-time, dan snapshot tren harian (cron daily-analytics) sudah 1x/hari - cache 24 jam
// cukup & memangkas call dashboard dari maks 2x/channel/hari jadi maks 1x (hemat ~separuh),
// tanpa bikin dashboard kehilangan data (maksimal 24 jam basi, konsisten dgn snapshot harian).
export const DASHBOARD_CACHE_MS = 24 * 60 * 60 * 1000;

// Fresh = masih dalam jendela cache (pakai cache, JANGAN call Buffer). Null/undefined = belum
// pernah di-cache -> tidak fresh (fetch). Terima Date atau epoch-ms.
export function isDashboardCacheFresh(cachedAt: Date | number | null | undefined, now: number = Date.now()): boolean {
  if (cachedAt == null) return false;
  const t = cachedAt instanceof Date ? cachedAt.getTime() : cachedAt;
  return now - t < DASHBOARD_CACHE_MS;
}
