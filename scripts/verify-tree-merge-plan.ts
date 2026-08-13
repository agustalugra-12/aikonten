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
