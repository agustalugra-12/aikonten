// Paket top-up kredit (2026-09-30, T5). Untuk pelanggan yang kuotanya habis sebelum akhir
// bulan - beli kredit tambahan tanpa upgrade paket. Sengaja KONSTANTA kode (bukan tabel DB
// spt `plans`) - jumlahnya sedikit & jarang berubah; kalau nanti perlu diedit dari admin,
// pindahkan ke tabel. Harga/kredit dari keputusan bisnis Agus (PRD T5).
//
// Model tetap 1 konten = 1 kredit (konsisten dgn CREDIT_COST_GENERATE).
export type TopupPack = {
  id: string;      // dipakai di merchantOrderId & validasi server (jangan percaya harga dari klien)
  nama: string;
  kredit: number;
  hargaIdr: number;
};

export const TOPUP_PACKS: TopupPack[] = [
  { id: "topup10", nama: "10 konten", kredit: 10, hargaIdr: 49_000 },
  { id: "topup25", nama: "25 konten", kredit: 25, hargaIdr: 99_000 },
  { id: "topup50", nama: "50 konten", kredit: 50, hargaIdr: 179_000 },
];

export function getTopupPack(id: string): TopupPack | null {
  return TOPUP_PACKS.find((p) => p.id === id) ?? null;
}
