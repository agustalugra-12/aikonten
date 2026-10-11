// Rate limiter in-memory (2026-10-11, keamanan) - app jalan 1 proses `next start`, jadi Map
// ini persisten antar-request (reset saat restart; cukup utk mitigasi brute-force login).
// ponytail: in-memory single-process; kalau kelak multi-instance, pindah ke Redis.
type Hit = { count: number; resetAt: number };
const store = new Map<string, Hit>();

export function cekRateLimit(key: string, maks: number): { blocked: boolean; retryAfter: number } {
  const now = Date.now();
  const h = store.get(key);
  if (!h || now >= h.resetAt) return { blocked: false, retryAfter: 0 };
  if (h.count >= maks) return { blocked: true, retryAfter: Math.ceil((h.resetAt - now) / 1000) };
  return { blocked: false, retryAfter: 0 };
}
export function catatGagal(key: string, windowMs: number): void {
  const now = Date.now();
  const h = store.get(key);
  if (!h || now >= h.resetAt) store.set(key, { count: 1, resetAt: now + windowMs });
  else h.count += 1;
}
export function resetRateLimit(key: string): void { store.delete(key); }

const iv = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now >= v.resetAt) store.delete(k);
}, 5 * 60 * 1000);
iv.unref?.();
