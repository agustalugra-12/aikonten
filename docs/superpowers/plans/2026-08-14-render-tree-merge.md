# Render Tree-Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti skema penggabungan klip long-form dari sequential (O(N²), >2 jam utk 44 klip) jadi tree/divide-and-conquer (O(N log N), target <1 jam), tanpa mengubah hasil visual (transisi/tipe/timing identik) dan tanpa menambah risiko OOM (tetap 2 input per panggilan ffmpeg).

**Architecture:** Pisahkan "planning" (pure, testable, tanpa ffmpeg - hitung urutan operasi merge & keputusan transisi sekali di awal) dari "execution" (jalankan operasi itu via ffmpeg sungguhan, 2 input per panggilan). Planning tinggal di `transitions.ts`, execution di `ffmpeg.ts`.

**Tech Stack:** TypeScript, Next.js 16 API routes, ffmpeg via `systemd-run --scope` (lihat `ffmpeg.ts` yg sudah ada), tidak ada test runner terinstall di proyek ini - verifikasi pakai script standalone dijalankan via `npx tsx`.

## Global Constraints

- Tiap panggilan ffmpeg WAJIB tetap cuma 2 input (`-i` dua kali) - properti OOM-safety dari fix sebelumnya tidak boleh berubah.
- Transisi/tipe/timing hasil akhir WAJIB identik dgn skema sequential lama (nol perubahan visual) - dijamin lewat `computeBoundaryPlans` yg sudah ada (`src/lib/render/transitions.ts:55-61`), dipakai apa adanya, tidak dihitung ulang per-node.
- `TRANSITION_DURATION_SECONDS` (0.5dtk), CRF (23), preset final (`veryfast`) - semua TIDAK berubah.
- Deploy ke KEDUA server (`/root/kontenpilot-ai` lokal = server lama, `admin@202.10.41.72:/home/admin/kontenpilot-ai` = server baru) - pola yg sudah dipakai sepanjang migrasi ini.
- JANGAN restart `kontenpilot-backend.service` di server manapun selagi ada render aktif (`ps aux | grep ffmpeg` harus kosong dulu) - insiden nyata sesi ini: restart di tengah render bikin proses jadi orphan/kepotong.

---

### Task 1: Rencana merge tree yang murni (testable tanpa ffmpeg)

**Files:**
- Modify: `src/lib/render/transitions.ts`
- Test: `scripts/verify-tree-merge-plan.ts` (baru, dijalankan manual via `npx tsx`, bukan test runner)

**Interfaces:**
- Consumes: `canUseTransition(durationA, durationB): boolean`, `getTransitionForStep(stepIndex, transitions): TransitionType`, `TRANSITION_DURATION_SECONDS: number`, `TransitionType` - semua SUDAH ADA di `transitions.ts`, tidak berubah.
- Produces:
  - `type ClipRef = { kind: "leaf"; clipIndex: number } | { kind: "step"; stepIndex: number }`
  - `type MergeStep = { left: ClipRef; right: ClipRef; boundaryIndex: number; isTransition: boolean; transitionType?: TransitionType; offsetSeconds: number; resultDurationSeconds: number }`
  - `function planTreeMerge(clipDurations: number[], transitions: TransitionType[]): MergeStep[]` - array kosong kalau `clipDurations.length <= 1`, else `N-1` steps terurut post-order (anak sebelum induk, step TERAKHIR = root/hasil akhir).
  - `function computeBoundaryPlans(clipDurations: number[], transitions: TransitionType[]): BoundaryPlan[]` (REFAKTOR dari kode yg sudah ada di `buildXfadeFilterComplex`, sekarang fungsi berdiri sendiri)
  - `type BoundaryPlan = { isTransition: boolean; transitionType?: TransitionType }`
  - `computeClipSequencePlan(clipDurations: number[], transitions: TransitionType[]): { totalDurationSeconds: number; clipStartOffsets: number[] }` (RENAME dari `buildXfadeFilterComplex` - field `filterComplex`/`outputLabel` DIHAPUS, sudah dead code, diverifikasi tidak dipakai di mana pun via grep sebelum task ini dimulai)

- [ ] **Step 1: Baca file saat ini utk pastikan baseline sebelum diubah**

Baca `src/lib/render/transitions.ts` penuh (108 baris) - pastikan isinya persis seperti yang didokumentasikan di spec (fungsi `getTransitionForStep`, `canUseTransition`, `buildXfadeFilterComplex` sudah ada dari fix OOM sebelumnya).

- [ ] **Step 2: Tulis script verifikasi (akan FAIL dulu - fungsi belum ada)**

Buat file baru `scripts/verify-tree-merge-plan.ts`:

```typescript
import {
  planTreeMerge,
  computeClipSequencePlan,
  computeBoundaryPlans,
  type TransitionType,
} from "../src/lib/render/transitions";

let failed = false;

function assertClose(actual: number, expected: number, msg: string) {
  if (Math.abs(actual - expected) > 0.01) {
    console.error(`FAIL: ${msg} - got ${actual}, expected ${expected}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${msg} - got ${a}, expected ${e}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function randomDurations(n: number, shortClipChance: number): number[] {
  const durations: number[] = [];
  for (let i = 0; i < n; i++) {
    durations.push(
      Math.random() < shortClipChance ? Math.random() * 1.4 + 0.2 : Math.random() * 15 + 2
    );
  }
  return durations;
}

const scenarios: Array<{ name: string; durations: number[] }> = [
  { name: "1 klip saja", durations: [10] },
  { name: "2 klip genap", durations: [5, 6] },
  { name: "3 klip ganjil", durations: [5, 6, 7] },
  { name: "44 klip acak (skala long-form nyata)", durations: randomDurations(44, 0.05) },
  { name: "banyak klip pendek <1.5dtk (jalur concat)", durations: randomDurations(20, 0.6) },
  { name: "semua klip pendek (semua jalur concat)", durations: new Array(10).fill(1.0) },
];

for (const { name, durations } of scenarios) {
  console.log(`\n=== ${name} (${durations.length} klip) ===`);
  const transitions: TransitionType[] = [];
  const sequential = computeClipSequencePlan(durations, transitions);

  if (durations.length <= 1) {
    assertClose(sequential.totalDurationSeconds, durations[0] ?? 0, `${name}: durasi total`);
    assertEqual(planTreeMerge(durations, transitions), [], `${name}: tree kosong utk <=1 klip`);
    continue;
  }

  const treeSteps = planTreeMerge(durations, transitions);
  assertEqual(treeSteps.length, durations.length - 1, `${name}: jumlah step tree = N-1`);

  const finalStep = treeSteps[treeSteps.length - 1];
  assertClose(finalStep.resultDurationSeconds, sequential.totalDurationSeconds, `${name}: durasi akhir tree = sequential`);

  // Invariant: SETIAP boundary asli (0..N-2) dipakai TEPAT SEKALI di seluruh tree.
  const boundaryIndices = treeSteps.map((s) => s.boundaryIndex).sort((a, b) => a - b);
  const expectedBoundaries = Array.from({ length: durations.length - 1 }, (_, i) => i);
  assertEqual(boundaryIndices, expectedBoundaries, `${name}: semua boundary asli terpakai tepat sekali`);

  // Invariant PALING PENTING: keputusan transisi (transisi/tidak + tipe) per boundary
  // di tree HARUS identik dgn keputusan flat computeBoundaryPlans utk boundary yg SAMA -
  // ini yg menjamin tree tidak mengubah hasil visual sama sekali.
  const flatPlans = computeBoundaryPlans(durations, transitions);
  for (const step of treeSteps) {
    const flatPlan = flatPlans[step.boundaryIndex];
    assertEqual(
      { isTransition: step.isTransition, transitionType: step.transitionType },
      { isTransition: flatPlan.isTransition, transitionType: flatPlan.transitionType },
      `${name}: boundary ${step.boundaryIndex} - keputusan tree = keputusan sequential`
    );
  }

  console.log(`  (${treeSteps.length} step, durasi akhir ${finalStep.resultDurationSeconds.toFixed(2)}dtk)`);
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}
```

- [ ] **Step 3: Jalankan, pastikan GAGAL (fungsi belum diimplementasi)**

Run: `cd /root/kontenpilot-ai && npx tsx scripts/verify-tree-merge-plan.ts`
Expected: Error TypeScript "has no exported member 'planTreeMerge'" (atau serupa) - fungsi belum ada di `transitions.ts`.

- [ ] **Step 4: Implementasi - refactor `transitions.ts`**

Ganti seluruh isi `src/lib/render/transitions.ts` mulai baris 44 (`export const TRANSITION_DURATION_SECONDS`) sampai akhir file (baris 108) dengan:

```typescript
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
```

- [ ] **Step 5: Jalankan verifikasi, pastikan SEMUA PASS**

Run: `cd /root/kontenpilot-ai && npx tsx scripts/verify-tree-merge-plan.ts`
Expected: Semua baris `PASS:`, diakhiri `=== SEMUA PASS ===`, exit code 0. Kalau ada `FAIL:`, baca pesannya (nama skenario + boundary index yg bermasalah) dan perbaiki `planTreeMerge`/`computeBoundaryPlans` sebelum lanjut - JANGAN lanjut ke Task 2 kalau ada yg FAIL.

- [ ] **Step 6: Compile check TypeScript penuh**

Run: `cd /root/kontenpilot-ai && npx tsc --noEmit -p tsconfig.json`
Expected: Tidak ada output (bersih). Kalau ada error dari file LAIN yg masih mengimpor `buildXfadeFilterComplex` (nama lama), itu diperbaiki di Task 2 - catat file mana yg error, lanjut ke Task 2.

- [ ] **Step 7: Commit**

```bash
cd /root/kontenpilot-ai
git add src/lib/render/transitions.ts scripts/verify-tree-merge-plan.ts
git commit -m "$(cat <<'EOF'
refactor(render): rencana tree-merge murni + testable (transitions.ts)

Ekstrak computeBoundaryPlans jadi fungsi berdiri sendiri, tambah planTreeMerge
(divide & conquer, tetap 2-input per operasi ffmpeg nanti). Rename
buildXfadeFilterComplex -> computeClipSequencePlan, hapus field filterComplex/
outputLabel yg sudah dead code. Diverifikasi via scripts/verify-tree-merge-plan.ts:
tree menghasilkan keputusan transisi identik dgn sequential utk tiap boundary asli
(termasuk skenario 44 klip, klip pendek <1.5dtk, ganjil/genap).
EOF
)"
```

---

### Task 2: Eksekusi tree-merge sungguhan (ffmpeg.ts)

**Files:**
- Modify: `src/lib/render/ffmpeg.ts`

**Interfaces:**
- Consumes (dari Task 1): `planTreeMerge`, `computeClipSequencePlan`, `type ClipRef`, `type MergeStep` dari `./transitions`.
- Produces: `mergeClipsTree(clipPaths: string[], clipDurations: number[], transitions: TransitionType[], outputPath: string, workDir: string): Promise<void>` - dipanggil `renderFinalVideo` (fungsi yg sudah ada), signature SAMA PERSIS dgn `mergeClipsIncrementally` yg diganti (drop-in replacement).

- [ ] **Step 1: Baca bagian relevan file saat ini**

Baca `src/lib/render/ffmpeg.ts` baris 1-30 (import) dan baris 211-346 (fungsi `mergeClipsIncrementally` lengkap + titik pemanggilannya di `renderFinalVideo`) - pastikan masih persis seperti yg didokumentasikan di spec sebelum diubah.

- [ ] **Step 2: Ganti import dari `./transitions`**

Cari blok import (baris 12-18):
```typescript
import {
  buildXfadeFilterComplex,
  canUseTransition,
  getTransitionForStep,
  TRANSITION_DURATION_SECONDS,
  type TransitionType,
} from "./transitions";
```

Ganti jadi:
```typescript
import {
  computeClipSequencePlan,
  planTreeMerge,
  TRANSITION_DURATION_SECONDS,
  type ClipRef,
  type TransitionType,
} from "./transitions";
```

(`canUseTransition`/`getTransitionForStep` tidak lagi dipakai LANGSUNG di file ini - sudah dibungkus di dalam `planTreeMerge`/`computeBoundaryPlans`. `buildXfadeFilterComplex` diganti `computeClipSequencePlan`.)

- [ ] **Step 3: Ganti fungsi `mergeClipsIncrementally` dgn `mergeClipsTree`**

Cari seluruh fungsi `mergeClipsIncrementally` (dari komentar `// Gabung klip 2 (akumulator...` sampai `}` penutup fungsi, sekitar baris 211-271) - ganti SELURUHNYA dengan:

```typescript
// Gabung klip via TREE (divide & conquer, 2026-08-14 - ganti skema sequential
// [mergeClipsIncrementally] yg O(N^2): akumulator makin panjang tiap langkah bikin
// render 44 klip >2 jam. Rencana LENGKAP [urutan operasi, keputusan transisi, offset]
// sudah dihitung MURNI tanpa ffmpeg di planTreeMerge (transitions.ts) - fungsi ini
// tinggal MENJALANKAN rencana itu apa adanya, tidak mengambil keputusan visual apa pun
// sendiri. Properti OOM-safety TETAP: tiap panggilan ffmpeg cuma 2 input, sama seperti
// skema sequential sebelumnya - cuma cara mengelompokkan operasinya yg berubah
// (pohon, bukan rantai lurus), total kerja re-encode turun dari O(N x durasi) jadi
// O(log N x durasi).
async function mergeClipsTree(
  clipPaths: string[],
  clipDurations: number[],
  transitions: TransitionType[],
  outputPath: string,
  workDir: string
): Promise<void> {
  const steps = planTreeMerge(clipDurations, transitions);
  const stepPaths: string[] = [];

  const resolvePath = (ref: ClipRef): string =>
    ref.kind === "leaf" ? clipPaths[ref.clipIndex] : stepPaths[ref.stepIndex];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isRoot = i === steps.length - 1;
    const stepOutput = isRoot ? outputPath : path.join(workDir, `merge_step_${i}.mp4`);

    const filter = step.isTransition
      ? `[0:v][1:v]xfade=transition=${step.transitionType}:duration=${TRANSITION_DURATION_SECONDS}:offset=${step.offsetSeconds.toFixed(3)}[vout]`
      : `[0:v][1:v]concat=n=2:v=1:a=0[vout]`;

    // "ultrafast" utk step ANTARA - file ini SEGERA di-decode ulang di step berikutnya
    // (induknya di pohon), kompresi efisien tidak relevan buat file yg langsung
    // dibuang. Step TERAKHIR (root, jadi `concatenated.mp4`) tetap "veryfast" - satu2nya
    // file dari fungsi ini yg kualitas/ukurannya benar2 dipakai lebih lanjut (overlay
    // final + diukur ulang durasinya).
    await run("ffmpeg", [
      "-y",
      "-i", resolvePath(step.left),
      "-i", resolvePath(step.right),
      "-filter_complex", filter,
      "-map", "[vout]",
      "-c:v", "libx264",
      "-preset", isRoot ? "veryfast" : "ultrafast",
      "-crf", "23",
      stepOutput,
    ]);

    stepPaths.push(stepOutput);
  }
}
```

- [ ] **Step 4: Update titik pemanggilan di `renderFinalVideo`**

Cari (sekitar baris 326-333, sudah bergeser krn Step 3 - cari via teks):
```typescript
    const { totalDurationSeconds: estimatedDuration, clipStartOffsets } = buildXfadeFilterComplex(
      normalizedDurations,
      opts.transitions || []
    );
    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    if (normalizedPaths.length === 1) {
      await run("ffmpeg", ["-y", "-i", normalizedPaths[0], "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", concatenatedPath]);
    } else {
      await mergeClipsIncrementally(normalizedPaths, normalizedDurations, opts.transitions || [], concatenatedPath, workDir);
    }
```

Ganti jadi:
```typescript
    const { totalDurationSeconds: estimatedDuration, clipStartOffsets } = computeClipSequencePlan(
      normalizedDurations,
      opts.transitions || []
    );
    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    if (normalizedPaths.length === 1) {
      await run("ffmpeg", ["-y", "-i", normalizedPaths[0], "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", concatenatedPath]);
    } else {
      await mergeClipsTree(normalizedPaths, normalizedDurations, opts.transitions || [], concatenatedPath, workDir);
    }
```

- [ ] **Step 5: Compile check TypeScript penuh**

Run: `cd /root/kontenpilot-ai && npx tsc --noEmit -p tsconfig.json`
Expected: Tidak ada output (bersih), tidak ada lagi referensi `buildXfadeFilterComplex`/`mergeClipsIncrementally` di mana pun.

Kalau masih ada error "not defined" utk `buildXfadeFilterComplex`, cari file lain yg mengimpornya: `grep -rn "buildXfadeFilterComplex" src/` - seharusnya nol hasil di luar `transitions.ts` sendiri.

- [ ] **Step 6: Jalankan ulang verifikasi Task 1 (pastikan tidak ada regresi)**

Run: `cd /root/kontenpilot-ai && npx tsx scripts/verify-tree-merge-plan.ts`
Expected: `=== SEMUA PASS ===` (sama seperti Task 1 Step 5 - Task ini tidak mengubah `transitions.ts`, cuma memverifikasi ulang tidak ada yg rusak).

- [ ] **Step 7: Commit**

```bash
cd /root/kontenpilot-ai
git add src/lib/render/ffmpeg.ts
git commit -m "$(cat <<'EOF'
refactor(render): eksekusi tree-merge (ganti mergeClipsIncrementally)

mergeClipsTree menjalankan rencana dari planTreeMerge (transitions.ts, Task
sebelumnya) apa adanya - tetap 2 input per panggilan ffmpeg (OOM-safety tidak
berubah), preset ultrafast utk step antara (sama optimisasi yg sudah ada di versi
sequential). Total kerja re-encode turun O(N^2) -> O(N log N) - target render
long-form (44 klip) dari >2 jam jadi <1 jam, belum divalidasi render sungguhan
(lihat Task 3).
EOF
)"
```

---

### Task 3: Deploy + validasi render sungguhan

**Files:** Tidak ada file baru - deploy hasil Task 1+2 ke kedua server, verifikasi via render nyata.

**Interfaces:** Tidak ada - task ini murni operasional (deploy + observasi), bukan kode baru.

- [ ] **Step 1: Cek tidak ada render aktif di server baru sebelum restart**

```bash
export SSHPASS='123agustaA@'
sshpass -e ssh -o StrictHostKeyChecking=accept-new admin@202.10.41.72 "ps aux | grep '[f]fmpeg'"
```
Expected: kosong. Kalau ADA output, JANGAN lanjut ke Step 2 - tunggu render selesai dulu (lihat `docs/superpowers/specs/2026-08-14-render-tree-merge-design.md` soal insiden restart-di-tengah-render).

- [ ] **Step 2: Transfer file + rebuild di server baru**

```bash
export SSHPASS='123agustaA@'
sshpass -e scp -o StrictHostKeyChecking=accept-new src/lib/render/transitions.ts src/lib/render/ffmpeg.ts admin@202.10.41.72:/home/admin/kontenpilot-ai/src/lib/render/
sshpass -e ssh admin@202.10.41.72 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /home/admin/kontenpilot-ai && npm run build 2>&1 | tail -10'
```
Expected: build selesai tanpa error TypeScript (output normal Next.js build, daftar route seperti biasa).

- [ ] **Step 3: Restart service di server baru**

```bash
export SSHPASS='123agustaA@'
sshpass -e ssh admin@202.10.41.72 "echo '123agustaA@' | sudo -S -p '' systemctl restart kontenpilot-backend.service && sleep 3 && systemctl is-active kontenpilot-backend.service"
```
Expected: `active`

- [ ] **Step 4: Konfirmasi ke Agus SEBELUM trigger render biaya nyata**

Ini titik STOP wajib - render long-form sungguhan pakai API berbayar (OpenAI/fal.ai/TTS) sama seperti test-test sebelumnya di sesi ini. JANGAN trigger otomatis - tanyakan dulu apakah Agus mau lanjut ke 1x render nyata sekarang, atau cukup percaya ke validasi murni (Task 1+2 sudah PASS) dan tunggu batch cron pertama yg sungguhan nanti.

- [ ] **Step 5 (kalau Agus setuju lanjut): Trigger render long-form, ukur waktu**

Pakai idea yg SAMA dgn test sebelumnya (`idea_z0DsnCp9GuNy`, brand `brand_Wo1tv4SSj_ac`) - login dulu (password `bedugul2026`), lalu trigger via `/api/brands/brand_Wo1tv4SSj_ac/auto-content` dgn body `{"script": "<isi idea_z0DsnCp9GuNy>", "type": "video"}`, jalankan sbg background process di server (`nohup ... & disown`) spy tidak kena timeout SSH klien, poll status project via `sqlite3 ... "select status from projects order by created_at desc limit 1;"` tiap 60 detik sampai `ready`/`failed`.

Expected: status akhir `ready` (bukan `failed`), total waktu (dari trigger sampai `ready`) DI BAWAH 1 jam. Catat waktu persis, bandingkan ke baseline sequential (>2 jam 19 menit).

- [ ] **Step 6: Verifikasi file video valid**

```bash
export SSHPASS='123agustaA@'
sshpass -e ssh admin@202.10.41.72 "sqlite3 /home/admin/kontenpilot-ai/data/kontenpilot.db \"select file_url from media_assets where project_id='<PROJECT_ID>' and type='final_video';\""
```
Download URL hasilnya, cek dgn `ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 <file>` - pastikan h264+aac, durasi masuk akal (>=240dtk sesuai minimum long-form), tidak corrupt.

- [ ] **Step 7: Deploy ke server lama juga**

```bash
cd /root/kontenpilot-ai
npm run build 2>&1 | tail -10
ps aux | grep "[f]fmpeg"
```
Expected build: bersih. Expected ps: kosong (tidak ada render aktif) - BARU lanjut restart kalau kosong:
```bash
sudo systemctl restart kontenpilot-backend.service
sleep 3
systemctl is-active kontenpilot-backend.service
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3100/
```
Expected: `active`, `HTTP 307`.

- [ ] **Step 8: Laporkan hasil ke Agus**

Ringkas: waktu render baru vs lama, hasil ffprobe, status deploy di kedua server. Ini penutup task - tidak ada commit kode baru di step ini (kode sudah di-commit Task 1 & 2).
