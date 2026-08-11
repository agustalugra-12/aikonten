// Overlay Engine (2026-08-10, PRD "AI Content Editing Engine" section 21/31) - Progress
// Bar (garis tipis di bawah, terisi seiring durasi - umum di format Shorts/TikTok
// modern). Filter FFmpeg native (drawbox) - nol biaya AI, murni komputasi lokal.
//
// CTA text polos SEBELUMNYA ada di sini (buildCtaTextFilter) - DIHAPUS 2026-08-11
// (permintaan Agus "animasi sebanyak mungkin, seperti subscribe apa bisa?"), diganti
// buildSubscribeButtonFilterStages (subscribeButton.ts) - tombol lonceng+box+pulse,
// bukan teks polos lagi. Dihapus total (bukan disimpan sbg fallback tak terpakai) -
// tidak ada pemanggil lain yg masih butuh versi polosnya.

// Progress bar - garis tipis SELALU tampil, lebar bertambah 0% -> 100% seiring waktu
// tayang. `w` pakai ekspresi waktu `t` (FFmpeg drawbox evaluasi ulang tiap frame secara
// default utk parameter numerik spt ini - TIDAK butuh `eval=frame` eksplisit, sudah
// perilaku bawaan filter ini utk ekspresi yg mengandung `t`).
export function buildProgressBarFilter(targetWidth: number, targetHeight: number, durationSeconds: number): string {
  const barHeight = Math.max(4, Math.round(targetHeight * 0.006)); // ~0.6% tinggi frame - tipis, tidak dominan
  return `drawbox=x=0:y=${targetHeight - barHeight}:w='iw*t/${durationSeconds.toFixed(2)}':h=${barHeight}:color=white@0.85:t=fill`;
}
