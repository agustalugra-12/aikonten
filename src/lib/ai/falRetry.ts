import { fal } from "@fal-ai/client";
import { logNonTokenUsage } from "./openaiClient";

// Retry wrapper utk fal.subscribe (2026-08-05, bug nyata ditemukan Agus - "kenapa bisa
// banyak percobaan yang gagal?" - ditemukan lewat tes live hari ini juga: fal.ai/Nano
// Banana 2 kadang gagal generate utk foto tertentu dgn error generik "Could not generate
// images with the given prompts and images" (bukan error format/validasi - foto/prompt
// yang SAMA bisa sukses di percobaan berikutnya) - kegagalan TRANSIEN model, bukan bug
// kode. Sebelumnya SATU kegagalan langsung bikin seluruh project berstatus "failed"
// permanen (harus diulang manual oleh Agus) - sekarang retry otomatis sampai
// MAX_ATTEMPTS sebelum benar2 menyerah, dgn jeda singkat antar percobaan (fal.ai
// disarankan tidak retry instan tanpa jeda).
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// Log detail LENGKAP (2026-08-11, permintaan Agus - "saldo fal.ai kok abis, kenapa bisa
// gagal?" - dicek LANGSUNG ke journalctl, gap nyata ditemukan: console.error SEBELUM ini
// cuma print `err.message` [utk error fal.ai jenis ApiError, message-nya SERING cuma
// frasa HTTP generik spt "Unprocessable Entity" - detail SUNGGUHAN [mis. field mana yg
// invalid, atau alasan model gagal generate] ada di `err.body`, yg TIDAK PERNAH
// ditampilkan sama sekali]. Kegagalan Aug 6 yg ketemu di log CUMA bilang "Unprocessable
// Entity" tanpa penjelasan lebih lanjut - akar masalahnya sendiri TIDAK BISA didiagnosis
// dari log yg ada, gap ini yg diperbaiki di sini (bukan menebak akar masalah tanpa data).
function describeError(err: unknown): string {
  if (err && typeof err === "object" && "status" in err) {
    const e = err as { status?: number; body?: unknown; message?: string };
    return `status=${e.status} message=${e.message} body=${JSON.stringify(e.body)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// 422 content_policy_violation ditemukan (2026-08-25, laporan Agus - "gagal render di
// fal.ai lihat lebih dari sekali") SELALU retry penuh 3x tanpa pernah sukses - masuk akal
// krn INPUT (prompt+gambar) SAMA PERSIS tiap percobaan, fal.ai menolak berdasarkan ISI
// input itu sendiri (bukan kegagalan transien server spt kasus "Could not generate
// images..." yg jadi alasan retry loop ini dibuat, lihat catatan atas) - percobaan ke-2/
// ke-3 dijamin ditolak lagi dgn alasan sama, cuma buang ~2-6 detik jeda + bikin log
// penuh noise identik. Nyerah di percobaan pertama utk error class ini SAJA (bukan utk
// error lain, spt "fetch failed"/kegagalan generate generik yg MASIH transien).
export function isContentPolicyViolation(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const e = err as { status?: number; body?: unknown };
  if (e.status !== 422) return false;
  const bodyStr = JSON.stringify(e.body ?? "");
  return bodyStr.includes("content_policy_violation");
}

export async function subscribeFalWithRetry(endpoint: string, input: Record<string, unknown>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fal.subscribe(endpoint, { input });
    } catch (err) {
      lastError = err;
      console.error(`[fal.subscribe] percobaan ${attempt}/${MAX_ATTEMPTS} gagal (${endpoint}): ${describeError(err)}`);
      // Visibilitas biaya (2026-08-11, permintaan Agus) - dicatat dgn cost_usd=0 SENGAJA
      // (BUKAN ditaksir $0.08 - kita TIDAK PUNYA cara memastikan fal.ai benar2 charge
      // percobaan gagal ini atau tidak dari sisi sini, cuma dashboard billing fal.ai yg
      // tahu pasti - mencatat angka karangan lebih menyesatkan drpd $0 dgn label jelas
      // "attempt-failed") - tujuannya supaya FREKUENSI kegagalan kelihatan di sistem
      // (query llm_usage_log WHERE model LIKE '%attempt-failed%'), sebelumnya kegagalan
      // sama sekali tidak ninggalkan jejak apa pun di sini.
      await logNonTokenUsage(`${endpoint}-attempt-failed`, 0);
      if (isContentPolicyViolation(err)) {
        console.error(`[fal.subscribe] content_policy_violation - input tidak akan berubah di percobaan berikutnya, nyerah sekarang (tidak retry).`);
        throw err;
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError;
}
