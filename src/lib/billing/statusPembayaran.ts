// Ambang waktu + pemetaan status jalur pembayaran (2026-11-07, perbaikan "layar menggantung").
// SENGAJA modul murni: tanpa import DB/next/env supaya dipakai BERSAMA oleh layar sukses
// (komponen klien) dan cron rekonsiliasi (server), dan bisa diuji tanpa DB & tanpa jaringan.

// Batas polling layar sukses. Webhook Tripay normalnya masuk beberapa detik setelah pelanggan
// bayar (Tripay retry s/d 3x dalam hitungan menit). 3 menit = cukup untuk webhook pertama +
// satu-dua retry, tapi tidak menyandera tab pelanggan selamanya. Lewat batas ini layar BERHENTI
// polling dan menampilkan "menunggu konfirmasi" lengkap dgn no. pesanan + kontak bantuan,
// bukan spinner abadi.
export const BATAS_POLL_MS = 3 * 60_000;

// Tagihan masih `pending` selewat ini = MENGGANTUNG (pelanggan mungkin sudah kirim uang tapi
// webhook tak sampai). Dipakai cron rekonsiliasi untuk memutuskan kapan lapor ke Telegram.
// 15 menit: jauh di atas waktu normal webhook, masih cukup cepat untuk ditolong manual
// sementara pelanggan menunggu.
export const AMBANG_MENGGANTUNG_MS = 15 * 60_000;

export function bolehPollLagi(elapsedMs: number): boolean {
  return elapsedMs < BATAS_POLL_MS;
}

// Jeda antar-cek: rapat di awal (pembayaran baru lunas), melebar setelahnya.
export function jedaPollMs(coba: number): number {
  return coba < 8 ? 2500 : 6000;
}

export function menggantung(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs >= AMBANG_MENGGANTUNG_MS;
}

// Status transaksi Tripay -> status billingLog kita. Dipakai cron rekonsiliasi; sengaja
// konservatif: apa pun yang tidak dikenal dianggap `pending` (jangan tandai gagal karena
// Tripay menambah status baru).
export type StatusTagihan = "sukses" | "gagal" | "pending";

export function petakanStatusTripay(status: string): StatusTagihan {
  const s = (status || "").toUpperCase();
  if (s === "PAID") return "sukses";
  if (s === "EXPIRED" || s === "FAILED" || s === "REFUND") return "gagal";
  return "pending";
}
