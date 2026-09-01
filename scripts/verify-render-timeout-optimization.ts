/* eslint-disable no-console */
// Verification gate (2026-09-01, audit reliability): optimasi render CPU untuk kasus
// nyata "Clark's Nutcracker" (Animal Story & Co) - ffmpeg timeout 120 menit di VPS
// 2-core, di-SIGKILL paksa. Root cause: stat-icon `eval=frame` scale & confetti `tpad`
// clone diproses SEPANJANG durasi video (bisa >7 menit long-form) padahal cuma tampil
// beberapa detik. Fix: trim (stat icon) + `-itsoffset` input-level (bell/confetti)
// menggantikan tpad clone yang mahal.
//
// Jalankan dengan: npx --yes tsx scripts/verify-render-timeout-optimization.ts

import { buildStatOverlayFilterStages } from "../src/lib/render/statOverlay";
import { buildLottieOverlayFilterStages, type LottieMeta } from "../src/lib/render/lottieOverlay";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function main() {
  console.log("Running render-timeout-optimization verification gate\n");

  // --- statOverlay: trim harus muncul SEBELUM scale/eval=frame, batas endSeconds+0.5 ---
  const statStages = buildStatOverlayFilterStages(2, "diet", "thousands of seeds", 39.0, 1080, 1920, "in", "statted0");
  const scaleStage = statStages.find((s) => s.includes("eval=frame"));
  check("stat overlay scale stage ditemukan", !!scaleStage);
  check(
    "stat overlay scale stage punya trim SEBELUM format=rgba",
    !!scaleStage && /trim=duration=41\.30,format=rgba/.test(scaleStage),
    scaleStage
  );
  check(
    "stat overlay filter count TIDAK berubah (masih 4 stage)",
    statStages.length === 4,
    `dapat ${statStages.length}`
  );
  // Video long-form (431s) tapi trim harus dekat endSeconds (~40.8), BUKAN full durasi -
  // ini bukti langsung fix-nya benar-benar memotong pemborosan (bukan cuma dekorasi).
  check(
    "trim TIDAK ikut full durasi video (bug lama akan lolos assert ini)",
    !!scaleStage && !scaleStage.includes("trim=duration=431"),
    scaleStage
  );

  // --- lottieOverlay: default (tanpa inputAlreadyOffset) tetap pakai tpad (backward compat utk caller "wow") ---
  const meta: LottieMeta = { frameCount: 100, fps: 20, nativeWidth: 1920, nativeHeight: 1080 };
  const defaultStages = buildLottieOverlayFilterStages(5, meta, 1920, 10.0, 0, 0, "in", "wow", {});
  const defaultFmtStage = defaultStages[0];
  check(
    "lottie overlay TANPA inputAlreadyOffset tetap pakai tpad (caller lama - reaction 'wow' - tidak boleh berubah)",
    defaultFmtStage.includes("tpad=start_duration=10.00:start_mode=clone")
  );

  // --- lottieOverlay: dgn inputAlreadyOffset:true (confetti, input sudah -itsoffset) - TIDAK boleh ada tpad ---
  const offsetStages = buildLottieOverlayFilterStages(7, meta, 1920, 427.86, 0, 0, "in", "confettied", {
    alpha: 0.55,
    inputAlreadyOffset: true,
  });
  const offsetFmtStage = offsetStages[0];
  check(
    "lottie overlay DGN inputAlreadyOffset:true TIDAK memakai tpad (fix utama - hilangkan clone 427 detik)",
    !offsetFmtStage.includes("tpad"),
    offsetFmtStage
  );
  check(
    "lottie overlay dgn inputAlreadyOffset:true tetap punya colorchannelmixer (alpha 0.55 tetap diterapkan)",
    offsetFmtStage.includes("colorchannelmixer=aa=0.55"),
    offsetFmtStage
  );
  // enable window di overlay stage TETAP pakai startSeconds absolut (427.86) - trim/offset
  // di INPUT tidak boleh mengubah kapan elemen ini terlihat di timeline output.
  const offsetOverlayStage = offsetStages[1];
  check(
    "lottie overlay enable window tetap benar (427.86 -> endSeconds) walau input sudah di-offset",
    offsetOverlayStage.includes("between(t,427.86,")
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
