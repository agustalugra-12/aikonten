import { buildContentBrief } from "../src/lib/ai/contentBrief";

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

const fakeProject = {
  script: "Ide: promo laundry bed cover",
  pillar: "Hard Selling/Promo",
  angle: "harga",
  hookType: "direct_benefit",
  structureTemplate: "Hook-Fasilitas-CTA",
  generatedCaption: "Hemat laundry bed cover... chat admin sekarang!",
  visualDirection: "close-up detail bed cover bersih, pacing tenang",
  ctaText: "Chat admin kami sekarang!",
  ideaScore: 82,
  ideaReasoning: "isi kekosongan pilar promo, performa historis tinggi",
  retentionRisks: JSON.stringify(["Intro terlalu panjang (~7dtk)"]),
};

{
  const brief = buildContentBrief(
    fakeProject,
    { contentGoals: "awareness + booking langsung", targetAudience: "villa & homestay Denpasar" },
    ["tiktok", "instagram"]
  );
  assertEqual(brief, {
    objective: "awareness + booking langsung",
    targetAudience: "villa & homestay Denpasar",
    platforms: ["tiktok", "instagram"],
    pillar: "Hard Selling/Promo",
    topic: "Ide: promo laundry bed cover",
    angle: "harga",
    hook: "direct_benefit",
    coreMessage: "Hemat laundry bed cover... chat admin sekarang!",
    storytellingStructure: "Hook-Fasilitas-CTA",
    visualDirection: "close-up detail bed cover bersih, pacing tenang",
    cta: "Chat admin kami sekarang!",
    referencePatterns: "isi kekosongan pilar promo, performa historis tinggi",
    score: 82,
    retentionRisks: ["Intro terlalu panjang (~7dtk)"],
  }, "buildContentBrief: semua field dirakit benar dari project+brand+platform");
}
{
  // Brand null (mis. race condition brand terhapus) - jangan crash, objective/targetAudience null
  const brief = buildContentBrief(fakeProject, null, []);
  assertEqual(brief.objective, null, "buildContentBrief: brand null -> objective null, tidak crash");
  assertEqual(brief.targetAudience, null, "buildContentBrief: brand null -> targetAudience null");
  assertEqual(brief.platforms, [], "buildContentBrief: tidak ada platform terhubung -> array kosong");
}
{
  // retentionRisks null (foto/carousel/YouTube Editorial) atau JSON rusak - jangan crash
  const brief1 = buildContentBrief({ ...fakeProject, retentionRisks: null }, null, []);
  assertEqual(brief1.retentionRisks, [], "buildContentBrief: retentionRisks null -> array kosong");
  const brief2 = buildContentBrief({ ...fakeProject, retentionRisks: "{rusak" }, null, []);
  assertEqual(brief2.retentionRisks, [], "buildContentBrief: retentionRisks JSON rusak -> array kosong, tidak crash");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}
