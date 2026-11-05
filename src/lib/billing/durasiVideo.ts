// Aturan durasi video tenant EKSTERNAL (2026-11-05): brand milik akun TANPA users.unlimited hanya boleh
// menghasilkan video 30-60 detik. Brand internal (owner unlimited) tetap aturan lama. Modul MURNI (tanpa DB)
// supaya dipakai backend (aturanProduk/processProject) DAN UI (pilihan durasi). "Eksternal" selalu dari flag
// unlimited pemilik brand (identitas tepercaya backend), bukan dari nama brand.
export const DURASI_EKSTERNAL = { min: 30, max: 60 } as const;
const PRESET_DURASI = [30, 60, 90, 180, 300, 480];

// Pilihan durasi di UI: portrait 30/60, landscape semua preset; eksternal dibatasi 30-60.
export function pilihanDurasiVideo(orientation: string | null | undefined, unlimited: boolean | null | undefined): number[] {
  const base = orientation === "landscape" ? PRESET_DURASI : [30, 60];
  return unlimited ? base : base.filter((d) => d >= DURASI_EKSTERNAL.min && d <= DURASI_EKSTERNAL.max);
}
export function durasiTargetDiizinkan(target: number, unlimited: boolean | null | undefined): boolean {
  return !!unlimited || (target >= DURASI_EKSTERNAL.min && target <= DURASI_EKSTERNAL.max);
}

// Overhead di luar narasi: intro HyperFrames 3 dtk / lead-in ffmpeg 1.4 dtk -> narasi eksternal maks 57 dtk.
export const VO_MAKS_EKSTERNAL = DURASI_EKSTERNAL.max - 3;
export const TEMPO_MAKS = 1.15;  // percepat narasi maks 15% (masih natural); lebih dari itu = gagal jelas
export const JEDA_MAKS = 8;      // tambah jeda/outro maks 8 dtk agar video >= 30 dtk; lebih = gagal jelas

// Target durasi utk NASKAH (anggaran kata = detik x WORDS_PER_SECOND). Eksternal: dijepit ke 32-55 dtk -
// margin dari batas 30/60 krn kecepatan bicara TTS nyata beda dari estimasi kata/detik.
export function targetNaskahDetik(target: number, unlimited: boolean | null | undefined): number {
  return unlimited ? target : Math.min(55, Math.max(32, target));
}

export type RencanaDurasiVo =
  | { aksi: "ok" }
  | { aksi: "percepat"; tempo: number }
  | { aksi: "tambah_jeda"; detik: number }
  | { aksi: "gagal"; pesan: string };
// Durasi audio TTS nyata -> koreksi murah (ffmpeg atempo / jeda di akhir) atau gagal jelas.
export function rencanaDurasiVoiceover(detik: number, unlimited: boolean | null | undefined): RencanaDurasiVo {
  if (unlimited || !Number.isFinite(detik)) return { aksi: "ok" };
  if (detik > VO_MAKS_EKSTERNAL) {
    const tempo = Math.ceil((detik / VO_MAKS_EKSTERNAL) * 1000) / 1000;
    if (tempo <= TEMPO_MAKS) return { aksi: "percepat", tempo };
    return { aksi: "gagal", pesan: `Narasi ${detik.toFixed(1)} detik terlalu panjang untuk batas video ${DURASI_EKSTERNAL.min}-${DURASI_EKSTERNAL.max} detik paket ini. Kredit dikembalikan; coba generate ulang atau persingkat naskah.` };
  }
  if (detik < DURASI_EKSTERNAL.min) {
    const kurang = Math.ceil((DURASI_EKSTERNAL.min - detik) * 10) / 10;
    if (kurang <= JEDA_MAKS) return { aksi: "tambah_jeda", detik: kurang };
    return { aksi: "gagal", pesan: `Narasi ${detik.toFixed(1)} detik terlalu pendek untuk batas video ${DURASI_EKSTERNAL.min}-${DURASI_EKSTERNAL.max} detik paket ini. Kredit dikembalikan; coba generate ulang dengan naskah lebih panjang.` };
  }
  return { aksi: "ok" };
}

// Batas keras durasi render (ffmpeg -t). Eksternal 60; internal ikut batas lain (Shorts/manifest) bila ada.
export function batasRenderDetik(unlimited: boolean | null | undefined, lain: number | null | undefined): number | undefined {
  const caps = [unlimited ? undefined : DURASI_EKSTERNAL.max, lain ?? undefined].filter((x): x is number => typeof x === "number" && x > 0);
  return caps.length ? Math.min(...caps) : undefined;
}
// Gerbang pasca-render: hasil eksternal wajib 30-60 dtk (toleransi 0.5 dtk pembulatan container).
export function cekDurasiHasil(detik: number, unlimited: boolean | null | undefined): string | null {
  if (unlimited) return null;
  if (detik < DURASI_EKSTERNAL.min - 0.5 || detik > DURASI_EKSTERNAL.max + 0.5) {
    return `Video hasil render ${detik} detik di luar batas ${DURASI_EKSTERNAL.min}-${DURASI_EKSTERNAL.max} detik paket ini. Kredit dikembalikan; coba generate ulang.`;
  }
  return null;
}
