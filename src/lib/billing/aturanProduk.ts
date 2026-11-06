import { CREDIT_COST_GENERATE } from "./credits";
import { DURASI_EKSTERNAL, durasiTargetDiizinkan } from "./durasiVideo";

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
  constructor(message = "Video panjang sementara tidak tersedia untuk paket ini. Silakan gunakan video pendek (maksimal 60 detik), foto, atau carousel.") {
    super(message);
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
  renderEngine?: string | null;
}): void {
  if (apakahVideoPanjang(args.type, args.contentFormat, args.videoDurationTarget) && !args.unlimited) {
    throw new VideoPanjangTidakTersediaError();
  }
  // Durasi tenant eksternal 30-60 dtk (2026-11-05, lihat durasiVideo.ts). Dicek SEBELUM potong kredit &
  // sebelum proses mahal; subclass VideoPanjangTidakTersediaError -> semua pemanggil (route 403, cron
  // kodeAturan "video_panjang" = lewati ide tanpa retry) menanganinya tanpa perubahan.
  if (args.type !== "video" || args.unlimited) return;
  const target = args.contentFormat === "youtube_shorts" ? 60 : (args.videoDurationTarget ?? 60);
  if (!durasiTargetDiizinkan(target, args.unlimited)) throw new DurasiVideoTidakValidError(`Durasi video ${target} detik tidak tersedia untuk paket ini. Pilih durasi ${DURASI_EKSTERNAL.min}-${DURASI_EKSTERNAL.max} detik.`);
  // Engine "scenes" = video desain musik-only ~10-15 dtk, tak bisa dikoreksi murah ke >=30 dtk -> tolak jelas.
  if (args.renderEngine === "scenes") throw new DurasiVideoTidakValidError(`Mode video Desain (scenes) menghasilkan video di bawah ${DURASI_EKSTERNAL.min} detik dan belum tersedia untuk paket ini. Ganti mesin render di Brand Kit ke standar.`);
}

export class DurasiVideoTidakValidError extends VideoPanjangTidakTersediaError {
  readonly kodeAturan = "durasi_video";
  constructor(message: string) {
    super(message);
    this.name = "DurasiVideoTidakValidError";
  }
}

// Plafon jumlah konten/hari per paket (batasHarianPaket) DIHAPUS 2026-11-01 atas permintaan Agus:
// jumlah video/foto/carousel/shorts per hari sepenuhnya pilihan user (Brand Settings). Pembatas
// nyata = saldo kredit bulanan (credits.ts), bukan cap harian per-tipe.
