import { fal } from "@fal-ai/client";

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

export async function subscribeFalWithRetry(endpoint: string, input: Record<string, unknown>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fal.subscribe(endpoint, { input });
    } catch (err) {
      lastError = err;
      console.error(
        `[fal.subscribe] percobaan ${attempt}/${MAX_ATTEMPTS} gagal (${endpoint}):`,
        err instanceof Error ? err.message : err
      );
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError;
}
