import { CREDIT_COST_GENERATE } from "./credits";

// Aturan produk (2026-10-24). (1) Biaya carousel = jumlah slide yang BENAR-BENAR dirender.
// (2) Video panjang (long-form) hanya untuk brand internal (akun `unlimited`), bukan tenant
// eksternal. SEMUA perhitungan/validasi DI BACKEND; JANGAN percaya nilai dari frontend;
// JANGAN tentukan "internal" dari nama brand kiriman pengguna — pakai flag `unlimited`
// (identitas tepercaya backend). Tak mengubah kebijakan refund yang sudah ada.

// Jumlah slide carousel yang dirender — HARUS sama dgn carouselN di processProject.ts:
// poster_feed (foto) = 1; selain itu min(carouselPhotosPerPost, 5). Render meng-cap 5 slide,
// jadi biaya mengikuti jumlah AKTUAL (1..5), bukan angka mentah dari request.
export function hitungJumlahSlideCarousel(
  contentFormat: string | null | undefined,
  carouselPhotosPerPost: number | null | undefined,
): number {
  if (contentFormat === "poster_feed") return 1;
  return Math.max(1, Math.min(carouselPhotosPerPost ?? 1, 5));
}

// Biaya kredit: carousel = jumlah slide; video & caption = CREDIT_COST_GENERATE (1).
export function hitungBiayaKredit(
  type: "video" | "carousel" | "caption",
  opts?: { contentFormat?: string | null; carouselPhotosPerPost?: number | null },
): number {
  if (type === "carousel") return hitungJumlahSlideCarousel(opts?.contentFormat, opts?.carouselPhotosPerPost);
  return CREDIT_COST_GENERATE[type];
}

// Long-form = type video, BUKAN youtube_shorts, target durasi > 60 dtk. Target null → 60
// (dianggap pendek) supaya video pendek TIDAK ikut terblokir.
export function apakahVideoPanjang(
  type: string,
  contentFormat: string | null | undefined,
  videoDurationTarget: number | null | undefined,
): boolean {
  if (type !== "video") return false;
  if (contentFormat === "youtube_shorts") return false;
  return (videoDurationTarget ?? 60) > 60;
}

export class VideoPanjangTidakTersediaError extends Error {
  readonly status = 403;
  constructor() {
    super("Video panjang sementara tidak tersedia untuk paket ini. Silakan gunakan video pendek (maksimal 60 detik), foto, atau carousel.");
    this.name = "VideoPanjangTidakTersediaError";
  }
}

// Izinkan long-form HANYA bila akun unlimited (brand internal). Tenant eksternal → lempar
// VideoPanjangTidakTersediaError. Video pendek / foto / carousel TIDAK terpengaruh.
export function pastikanFormatDiizinkan(args: {
  type: string;
  contentFormat: string | null | undefined;
  videoDurationTarget: number | null | undefined;
  unlimited: boolean | null | undefined;
}): void {
  if (apakahVideoPanjang(args.type, args.contentFormat, args.videoDurationTarget) && !args.unlimited) {
    throw new VideoPanjangTidakTersediaError();
  }
}

export type BatasHarian = { video: number; foto: number; carousel: number; shorts: number };

// Plafon jumlah konten/hari per paket (2026-10-24). Membatasi beban render (video) & volume
// agar box 1-proses tak kewalahan + adil per paket. Di-tune di SATU tempat. Paket tak dikenal
// / tanpa paket → starter (paling konservatif). Brand internal (unlimited) tidak di-cap (lihat pemakai).
export const BATAS_HARIAN_PAKET: Record<string, BatasHarian> = {
  starter: { video: 1, foto: 2, carousel: 1, shorts: 0 },
  pro:     { video: 3, foto: 3, carousel: 2, shorts: 1 },
  agency:  { video: 5, foto: 5, carousel: 2, shorts: 2 },
};
export function batasHarianPaket(namaPaket: string | null | undefined): BatasHarian {
  return BATAS_HARIAN_PAKET[(namaPaket ?? "").toLowerCase()] ?? BATAS_HARIAN_PAKET.starter;
}
