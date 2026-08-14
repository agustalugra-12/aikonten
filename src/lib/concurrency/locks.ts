// In-memory keyed mutex (temuan #1/#2, Lampiran D ENGINEERING_SAFETY.md / audit
// kontenpilot 2026-08-14 - lihat docs/_audit_kontenpilot_raw.md §4/§6). KontenPilot
// jalan sbg 1 PROSES Next.js TUNGGAL (systemd-managed `next start`, tidak ada worker/
// queue terpisah - dikonfirmasi audit) - jadi Map/Set in-memory sederhana ini SUDAH
// cukup, BUKAN distributed lock (Redis/DB advisory lock dst TIDAK diperlukan, over-
// engineering utk bentuk deployment ini).
//
// Kenapa aman tanpa race walau async: `tryAcquire`/`release` di bawah SEPENUHNYA
// sinkron (tidak ada `await` di dalam) - Node.js single-threaded, jadi TIDAK ADA
// interleaving mungkin terjadi di antara cek `has()` & `add()`, sama sekali beda dari
// race window yg terjadi di operasi ASYNC (mis. `alreadySucceededAccountIds` punya race
// window krn ada `await db...` di antara baca & tulis - lihat orchestrate.ts). Lock ini
// justru dipakai utk MENUTUP race semacam itu.
//
// Restart proses (systemd, deploy/crash) otomatis membersihkan SEMUA lock (state
// in-memory hilang begitu proses mati) - ini SENGAJA bukan bug: kalau proses crash
// mid-processing, lock yg "nyangkut" tidak relevan lagi krn kerja yg dikuncinya sendiri
// juga sudah mati bareng proses itu. Restart = recovery yg BENAR di sini, TIDAK perlu
// TTL/expiry/persistence tambahan (itu akan over-engineering utk single-process app
// tanpa worker terpisah).
export class LockBusyError extends Error {
  readonly key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = "LockBusyError";
    this.key = key;
  }
}

class KeyedLock {
  private readonly held = new Set<string>();

  /** true = lock berhasil diambil (milik pemanggil sekarang). false = sedang dipegang proses lain, TIDAK diberikan. */
  tryAcquire(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  release(key: string): void {
    this.held.delete(key);
  }

  isHeld(key: string): boolean {
    return this.held.has(key);
  }
}

// SATU registry module-level dipakai bareng semua domain lock (brand-level auto-content,
// project-level process, project-level publish) - key di-prefix per domain (lihat
// pemakaian di cron/auto-generate, brands/[id]/auto-content, processProject.ts,
// orchestrate.ts) supaya TIDAK saling tabrak walau projectId/brandId kebetulan sama
// bentuknya (tidak akan terjadi krn prefix beda, tapi eksplisit lebih aman drpd
// mengandalkan namespace ID yg kebetulan tidak pernah tabrak).
const registry = new KeyedLock();

export function tryAcquireLock(key: string): boolean {
  return registry.tryAcquire(key);
}

export function releaseLock(key: string): void {
  registry.release(key);
}

export function isLockHeld(key: string): boolean {
  return registry.isHeld(key);
}

// Key builder terpusat per domain (2026-08-14, temuan #1 Lampiran D) - dipakai BARENG
// oleh 2 entry point yg SAMA-SAMA berujung ke runAutoContent() utk brand yg sama:
// cron/auto-generate (batch harian) dan /api/brands/[id]/auto-content (tombol manual
// "⚡ Konten Otomatis") - fungsi ini yg jamin key-nya SELALU sama persis (bukan 2 string
// template terpisah yg bisa menyimpang diam-diam), supaya keduanya benar2 saling block.
export function brandAutoContentLockKey(brandId: string): string {
  return `brand-auto-content:${brandId}`;
}

// Key builder per-project - process (generate/render, temuan #1) vs publish (temuan
// #2). SENGAJA prefix beda (bukan 1 key per projectId) - render & publish adalah 2
// tahap yg biasanya tidak overlap (publish baru jalan setelah status "ready"), tidak
// ada alasan menyatukan lock-nya kalau tidak perlu (menghindari 1 tahap tanpa sengaja
// mem-block tahap lain yg sebenarnya independen).
export function projectProcessLockKey(projectId: string): string {
  return `project-process:${projectId}`;
}

export function projectPublishLockKey(projectId: string): string {
  return `project-publish:${projectId}`;
}

/**
 * Jalankan `fn` di bawah lock `key`. Lock SELALU dilepas di `finally` (termasuk kalau
 * `fn` throw) - supaya 1 project/brand yg gagal tidak pernah mengunci key itu selamanya
 * selama proses masih hidup. Kalau key sedang dipegang, lempar LockBusyError TANPA
 * menjalankan `fn` sama sekali (caller yg putuskan mau skip diam-diam atau balikin
 * error jelas ke pemanggilnya - lihat pemakaian di cron/auto-generate [skip] vs
 * processProject/publishProject [reject 409]).
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!tryAcquireLock(key)) {
    throw new LockBusyError(key, `Sedang diproses oleh proses lain: ${key}`);
  }
  try {
    return await fn();
  } finally {
    releaseLock(key);
  }
}
