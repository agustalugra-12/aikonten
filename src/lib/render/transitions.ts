// Transisi (2026-08-10, PRD "AI Content Editing Engine") - pipeline lama concat DEMUXER
// murni (`-c copy`, stream-copy tanpa re-encode) - cepat tapi cuma hard-cut, TIDAK ADA
// transisi sama sekali. FFmpeg filter `xfade` PUNYA puluhan preset transisi BAWAAN
// (dicek ke dokumentasi resmi FFmpeg sebelum dipakai) - reuse preset native drpd bikin
// matematika blending sendiri. Konsekuensi: xfade WAJIB re-encode (bukan stream-copy
// lagi), sedikit lebih lambat drpd concat demuxer lama - trade-off yg sepadan utk hasil
// yg terlihat "diedit", bukan cuma ditempel.
// "fadewhite"/"hblur"/"coverleft" ditambahkan 2026-08-10 (PRD minta Flash/Blur/Push -
// dicek dulu LANGSUNG ke build ffmpeg server ini via `ffmpeg -h filter=xfade` sblm
// dipakai, bukan diasumsikan dari dokumentasi: nama preset xfade TIDAK PERSIS sama dgn
// istilah umum, "fadewhite" = flash-ke-putih [padanan terdekat "Flash" editorial],
// "hblur" = blur transisi horizontal, "coverleft" = klip baru "mendorong" klip lama
// keluar dari kanan [padanan terdekat "Push"] - ketiganya dikonfirmasi ADA di preset
// xfade bawaan ffmpeg, bukan nama karangan sendiri).
// "hlwind"/"hrwind" ditambahkan 2026-08-10 (preset editing Animal Story & Co minta
// "Whip" transition) - dicek lagi ke `ffmpeg -h filter=xfade` server ini SEBELUM
// dipakai (sama disiplin dgn fadewhite/hblur/coverleft), preset "wind" adalah padanan
// FFmpeg native TERDEKAT ke whip-pan editorial (footage "tertiup" cepat ke satu arah).
export type TransitionType =
  | "fade"
  | "slideleft"
  | "slideright"
  | "zoomin"
  | "circleopen"
  | "fadewhite"
  | "hblur"
  | "coverleft"
  | "hlwind"
  | "hrwind";

export const ALL_TRANSITION_TYPES: TransitionType[] = [
  "fade",
  "slideleft",
  "slideright",
  "zoomin",
  "circleopen",
  "fadewhite",
  "hblur",
  "coverleft",
  "hlwind",
  "hrwind",
];

// 0.5dtk - cukup terasa TANPA bikin video terasa lambat/ngambang (PRD: "transisi halus
// dan tidak berlebihan"). Klip WAJIB >= 1.5dtk (sama floor dgn camera motion) supaya
// transisi tidak "memakan" sebagian besar durasi klip pendek.
export const TRANSITION_DURATION_SECONDS = 0.5;
const MIN_CLIP_DURATION_FOR_TRANSITION = 1.5;

// Diekstrak (2026-08-14) supaya dipakai BARENG oleh computeClipSequencePlan (metadata -
// clipStartOffsets/totalDurationSeconds, dihitung upfront utk overlay/sticker) DAN
// planTreeMerge di bawah (rencana eksekusi render SUNGGUHAN, lihat mergeClipsTree di
// ffmpeg.ts) - SATU sumber kebenaran formula per-langkah, supaya offset yg dihitung
// upfront selalu cocok persis dgn yg benar2 dirender.
export function getTransitionForStep(stepIndex: number, transitions: TransitionType[]): TransitionType {
  return transitions[stepIndex] || ALL_TRANSITION_TYPES[stepIndex % ALL_TRANSITION_TYPES.length];
}

export function canUseTransition(durationA: number, durationB: number): boolean {
  return durationA >= MIN_CLIP_DURATION_FOR_TRANSITION && durationB >= MIN_CLIP_DURATION_FOR_TRANSITION;
}

export type BoundaryPlan = { isTransition: boolean; transitionType?: TransitionType };

// Keputusan per-boundary (transisi/potong-langsung + tipe) utk N klip - MURNI fungsi
// durasi klip, TIDAK bergantung sama sekali pada bagaimana penggabungan fisik
// dieksekusi (sequential ATAU tree, hasilnya harus identik). Dipakai BARENG oleh
// computeClipSequencePlan (closed sequential, utk metadata offset/durasi) dan
// planTreeMerge (eksekusi tree, 2026-08-14 - lihat catatan lengkap di situ soal kenapa
// tree TIDAK menghitung ulang eligibility sendiri, cuma REUSE hasil di sini).
export function computeBoundaryPlans(clipDurations: number[], transitions: TransitionType[]): BoundaryPlan[] {
  if (clipDurations.length <= 1) return [];
  const plans: BoundaryPlan[] = [];
  let runningDuration = clipDurations[0];
  for (let i = 1; i < clipDurations.length; i++) {
    const clipDuration = clipDurations[i];
    if (canUseTransition(runningDuration, clipDuration)) {
      const transitionType = getTransitionForStep(i - 1, transitions);
      plans.push({ isTransition: true, transitionType });
      runningDuration = runningDuration + clipDuration - TRANSITION_DURATION_SECONDS;
    } else {
      plans.push({ isTransition: false });
      runningDuration = runningDuration + clipDuration;
    }
  }
  return plans;
}

// Metadata sequential (RENAME 2026-08-14 dari buildXfadeFilterComplex - field
// filterComplex/outputLabel [string filter gabungan utk 1 panggilan ffmpeg N-input]
// DIHAPUS, sudah dead code sejak render dieksekusi 2-klip-per-panggilan [lihat
// ffmpeg.ts], diverifikasi via grep sebelum dihapus). Dipakai render.ts HANYA utk
// clipStartOffsets (posisi tiap klip di timeline final, dibutuhkan Sticker/Overlay) -
// totalDurationSeconds sendiri SELALU diukur ulang dari file hasil render asli
// (lihat `void estimatedDuration` di ffmpeg.ts), bukan dipercaya mentah2.
export function computeClipSequencePlan(
  clipDurations: number[],
  transitions: TransitionType[]
): { totalDurationSeconds: number; clipStartOffsets: number[] } {
  if (clipDurations.length === 0) throw new Error("Tidak ada klip utk disambung");
  if (clipDurations.length === 1) {
    return { totalDurationSeconds: clipDurations[0], clipStartOffsets: [0] };
  }
  const boundaryPlans = computeBoundaryPlans(clipDurations, transitions);
  let runningDuration = clipDurations[0];
  const clipStartOffsets: number[] = [0];
  for (let i = 1; i < clipDurations.length; i++) {
    const plan = boundaryPlans[i - 1];
    if (plan.isTransition) {
      clipStartOffsets.push(Math.max(0, runningDuration - TRANSITION_DURATION_SECONDS));
      runningDuration = runningDuration + clipDurations[i] - TRANSITION_DURATION_SECONDS;
    } else {
      clipStartOffsets.push(runningDuration);
      runningDuration = runningDuration + clipDurations[i];
    }
  }
  return { totalDurationSeconds: runningDuration, clipStartOffsets };
}

export type ClipRef = { kind: "leaf"; clipIndex: number } | { kind: "step"; stepIndex: number };

export type MergeStep = {
  left: ClipRef;
  right: ClipRef;
  boundaryIndex: number;
  isTransition: boolean;
  transitionType?: TransitionType;
  offsetSeconds: number;
  resultDurationSeconds: number;
};

// Rencana LENGKAP eksekusi tree-merge (2026-08-14, ganti skema sequential O(N^2) yg
// bikin render 44 klip >2 jam - lihat docs/superpowers/specs/2026-08-14-render-tree-merge-design.md).
// MURNI (tanpa ffmpeg) - array hasil = urutan eksekusi post-order (anak2 sebelum
// induknya), step TERAKHIR = root (hasil akhir gabungan SEMUA klip). mergeClipsTree
// di ffmpeg.ts tinggal jalanin array ini apa adanya, resolve ClipRef ke path file
// sungguhan (leaf -> file klip ternormalisasi, step -> output langkah sebelumnya).
//
// Kenapa boundaryIndex SELALU benar (jaminan korektnes inti desain ini): rekursi
// `build(lo,hi)` split di `mid` - kiri mencakup klip asli [lo..mid], kanan [mid+1..hi],
// TIDAK PEDULI seberapa dalam rekursi di masing2 sisi. Titik sambung keduanya SELALU
// persis boundary original antara klip `mid` dan `mid+1` - tidak ada ambiguitas.
// Keputusan transisi (isTransition/transitionType) diambil dari computeBoundaryPlans
// yg SUDAH dihitung sekali di awal (BUKAN dihitung ulang pakai durasi segmen gabungan) -
// ini yg menjamin tree tidak mengubah hasil visual sama sekali dibanding sequential.
export function planTreeMerge(clipDurations: number[], transitions: TransitionType[]): MergeStep[] {
  if (clipDurations.length <= 1) return [];
  const boundaryPlans = computeBoundaryPlans(clipDurations, transitions);
  const steps: MergeStep[] = [];

  function build(lo: number, hi: number): { ref: ClipRef; duration: number } {
    if (lo === hi) {
      return { ref: { kind: "leaf", clipIndex: lo }, duration: clipDurations[lo] };
    }
    const mid = Math.floor((lo + hi) / 2);
    const left = build(lo, mid);
    const right = build(mid + 1, hi);
    const plan = boundaryPlans[mid];
    const resultDuration = plan.isTransition
      ? left.duration + right.duration - TRANSITION_DURATION_SECONDS
      : left.duration + right.duration;
    const offsetSeconds = plan.isTransition ? Math.max(0, left.duration - TRANSITION_DURATION_SECONDS) : 0;
    steps.push({
      left: left.ref,
      right: right.ref,
      boundaryIndex: mid,
      isTransition: plan.isTransition,
      transitionType: plan.transitionType,
      offsetSeconds,
      resultDurationSeconds: resultDuration,
    });
    return { ref: { kind: "step", stepIndex: steps.length - 1 }, duration: resultDuration };
  }

  build(0, clipDurations.length - 1);
  return steps;
}
