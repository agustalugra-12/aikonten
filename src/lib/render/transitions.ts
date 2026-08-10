// Transisi (2026-08-10, PRD "AI Content Editing Engine") - pipeline lama concat DEMUXER
// murni (`-c copy`, stream-copy tanpa re-encode) - cepat tapi cuma hard-cut, TIDAK ADA
// transisi sama sekali. FFmpeg filter `xfade` PUNYA puluhan preset transisi BAWAAN
// (dicek ke dokumentasi resmi FFmpeg sebelum dipakai) - reuse preset native drpd bikin
// matematika blending sendiri. Konsekuensi: xfade WAJIB re-encode (bukan stream-copy
// lagi), sedikit lebih lambat drpd concat demuxer lama - trade-off yg sepadan utk hasil
// yg terlihat "diedit", bukan cuma ditempel.
export type TransitionType = "fade" | "slideleft" | "slideright" | "zoomin" | "circleopen";

export const ALL_TRANSITION_TYPES: TransitionType[] = ["fade", "slideleft", "slideright", "zoomin", "circleopen"];

// 0.5dtk - cukup terasa TANPA bikin video terasa lambat/ngambang (PRD: "transisi halus
// dan tidak berlebihan"). Klip WAJIB >= 1.5dtk (sama floor dgn camera motion) supaya
// transisi tidak "memakan" sebagian besar durasi klip pendek.
export const TRANSITION_DURATION_SECONDS = 0.5;
const MIN_CLIP_DURATION_FOR_TRANSITION = 1.5;

// Bangun filter_complex chain xfade utk N video input (SUDAH dinormalisasi resolusi/fps
// sama - lihat ffmpeg.ts) - iteratif (bukan closed-form), krn tiap xfade "memakan"
// TRANSITION_DURATION_SECONDS dari durasi gabungan berjalan, lebih aman dihitung
// langkah-demi-langkah drpd rumus tertutup yg rawan salah off-by-one.
export function buildXfadeFilterComplex(
  clipDurations: number[],
  transitions: TransitionType[]
): { filterComplex: string; outputLabel: string; totalDurationSeconds: number; clipStartOffsets: number[] } {
  if (clipDurations.length === 0) throw new Error("Tidak ada klip utk disambung");
  if (clipDurations.length === 1) {
    return { filterComplex: "", outputLabel: "0:v", totalDurationSeconds: clipDurations[0], clipStartOffsets: [0] };
  }

  let filterParts: string[] = [];
  let prevLabel = "0:v";
  let runningDuration = clipDurations[0];
  // Titik mulai TIAP klip di timeline FINAL (2026-08-10, dipakai Sticker/Emoji Overlay
  // di bawah utk tahu KAPAN klip ke-i mulai tampil, supaya sticker muncul TEPAT di
  // awal klip yg dipilih, bukan di timestamp sembarang) - klip 0 SELALU mulai di 0.
  const clipStartOffsets: number[] = [0];

  for (let i = 1; i < clipDurations.length; i++) {
    const clipDuration = clipDurations[i];
    const canTransition = runningDuration >= MIN_CLIP_DURATION_FOR_TRANSITION && clipDuration >= MIN_CLIP_DURATION_FOR_TRANSITION;
    const transitionType = transitions[i - 1] || ALL_TRANSITION_TYPES[(i - 1) % ALL_TRANSITION_TYPES.length];
    const outLabel = `v${i}`;

    if (canTransition) {
      const offset = Math.max(0, runningDuration - TRANSITION_DURATION_SECONDS);
      filterParts.push(
        `[${prevLabel}][${i}:v]xfade=transition=${transitionType}:duration=${TRANSITION_DURATION_SECONDS}:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      clipStartOffsets.push(offset);
      runningDuration = runningDuration + clipDuration - TRANSITION_DURATION_SECONDS;
    } else {
      // Klip terlalu pendek utk transisi mulus - concat biasa (tanpa overlap) drpd
      // hasil aneh/error, durasi gabungan cuma dijumlah apa adanya.
      filterParts.push(`[${prevLabel}][${i}:v]concat=n=2:v=1:a=0[${outLabel}]`);
      clipStartOffsets.push(runningDuration);
      runningDuration = runningDuration + clipDuration;
    }
    prevLabel = outLabel;
  }

  return { filterComplex: filterParts.join(";\n"), outputLabel: prevLabel, totalDurationSeconds: runningDuration, clipStartOffsets };
}
