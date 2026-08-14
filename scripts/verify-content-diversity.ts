import {
  tallyStructureAndHookUsage,
  pickLeastUsedTemplate,
  isStructureOverused,
  isHookTypeOverused,
  buildHookAvoidInstruction,
  type StructureHookUsage,
} from "../src/lib/ai/contentVariety";

let failed = false;

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

function assertTrue(actual: boolean, msg: string) {
  assertEqual(actual, true, msg);
}

// tallyStructureAndHookUsage
{
  const usage = tallyStructureAndHookUsage([
    { structureTemplate: "A", hookType: "curiosity" },
    { structureTemplate: "A", hookType: "curiosity" },
    { structureTemplate: "B", hookType: null },
    { structureTemplate: null, hookType: "problem" },
  ]);
  assertEqual(usage.structureCounts.get("A"), 2, "tally: struktur A dihitung 2x");
  assertEqual(usage.structureCounts.get("B"), 1, "tally: struktur B dihitung 1x");
  assertEqual(usage.hookTypeCounts.get("curiosity"), 2, "tally: hook curiosity dihitung 2x");
  assertEqual(usage.hookTypeCounts.get("problem"), 1, "tally: hook problem dihitung 1x (dari row struktur null)");
  assertEqual(usage.structureCounts.has("C"), false, "tally: struktur yg tidak pernah muncul tidak ada di map");
}

// pickLeastUsedTemplate - kasus tidak ada seri (satu jelas paling jarang)
{
  const pool = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const counts = new Map([["A", 5], ["B", 1], ["C", 3]]);
  const picked = pickLeastUsedTemplate(pool, counts);
  assertEqual(picked.name, "B", "pickLeastUsedTemplate: pilih B (count paling rendah, 1)");
}

// pickLeastUsedTemplate - semua seri di 0 (kasus brand baru) - harus SELALU pilih dari
// himpunan {A,B,C}, tidak pernah error/undefined, dites via banyak iterasi.
{
  const pool = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    seen.add(pickLeastUsedTemplate(pool, counts).name);
  }
  assertTrue(
    [...seen].every((n) => ["A", "B", "C"].includes(n)),
    "pickLeastUsedTemplate: seri total (semua 0) - hasil selalu dari pool valid"
  );
}

// isStructureOverused / isHookTypeOverused - threshold persis (2 utk struktur, 3 utk hook)
{
  const usage: StructureHookUsage = {
    structureCounts: new Map([["Hook-Peak-Fasilitas-CTA", 3]]),
    hookTypeCounts: new Map([["curiosity", 4]]),
  };
  assertTrue(isStructureOverused("Hook-Peak-Fasilitas-CTA", usage), "isStructureOverused: 3x (>2) terdeteksi overused");
  assertEqual(isStructureOverused("Problem-Solution-Fasilitas-CTA", usage), false, "isStructureOverused: 0x tidak overused");
  assertTrue(isHookTypeOverused("curiosity", usage), "isHookTypeOverused: 4x (>3) terdeteksi overused");
  assertEqual(isHookTypeOverused("problem", usage), false, "isHookTypeOverused: 0x tidak overused");
  assertEqual(isHookTypeOverused(null, usage), false, "isHookTypeOverused: null hookType tidak pernah overused");
}
{
  // Batas TEPAT threshold - 2x struktur BELUM overused (harus >2, bukan >=2)
  const usage: StructureHookUsage = {
    structureCounts: new Map([["A", 2]]),
    hookTypeCounts: new Map([["curiosity", 3]]),
  };
  assertEqual(isStructureOverused("A", usage), false, "isStructureOverused: TEPAT 2x belum overused (threshold >2)");
  assertEqual(isHookTypeOverused("curiosity", usage), false, "isHookTypeOverused: TEPAT 3x belum overused (threshold >3)");
}

// buildHookAvoidInstruction
{
  const empty = buildHookAvoidInstruction(new Map());
  assertEqual(empty, "", "buildHookAvoidInstruction: map kosong -> string kosong");

  const withUsage = buildHookAvoidInstruction(new Map([["curiosity", 3], ["problem", 1], ["data", 2]]));
  assertTrue(withUsage.includes("curiosity (3x)"), "buildHookAvoidInstruction: menyebut curiosity 3x");
  assertTrue(withUsage.includes("data (2x)"), "buildHookAvoidInstruction: menyebut data 2x");
  assertTrue(!withUsage.includes("problem"), "buildHookAvoidInstruction: TIDAK menyebut problem (cuma 1x, di bawah ambang tampil)");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}
