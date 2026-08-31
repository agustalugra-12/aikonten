import { parsePlatformFitScores } from "../src/lib/ai/researchTopics";

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

{
  assertEqual(
    parsePlatformFitScores({ tiktok: 94, instagram: 91 }, ["tiktok", "instagram"]),
    { tiktok: 94, instagram: 91 },
    "parsePlatformFitScores: skor valid utk platform yg terhubung dipakai apa adanya"
  );
}
{
  // AI mengarang platform yg brand ini TIDAK terhubung - HARUS dibuang, jangan dipercaya
  assertEqual(
    parsePlatformFitScores({ tiktok: 94, youtube: 80 }, ["tiktok"]),
    { tiktok: 94 },
    "parsePlatformFitScores: platform yg tidak terhubung (youtube) dibuang"
  );
}
{
  assertEqual(
    parsePlatformFitScores({ tiktok: 150, instagram: -10 }, ["tiktok", "instagram"]),
    { tiktok: 100, instagram: 0 },
    "parsePlatformFitScores: clamp 0-100"
  );
}
{
  assertEqual(
    parsePlatformFitScores({ tiktok: "bagus" }, ["tiktok"]),
    {},
    "parsePlatformFitScores: non-number dibuang (bukan dipaksa 0)"
  );
}
{
  assertEqual(parsePlatformFitScores(null, ["tiktok"]), {}, "parsePlatformFitScores: raw null -> kosong");
  assertEqual(parsePlatformFitScores({ tiktok: 90 }, []), {}, "parsePlatformFitScores: connectedPlatforms kosong -> kosong");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}
