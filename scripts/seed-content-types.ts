// Seed Content Type Taxonomy (TIER 1 - 2026-08-14)
// Initial 16 system content types - extensible architecture, dapat ditambah via INSERT
// tanpa code change. Run once after migration 0031.

import { db } from "../src/db";
import { contentTypes } from "../src/db/schema";
import { eq } from "drizzle-orm";

const SYSTEM_CONTENT_TYPES = [
  {
    id: "ct_educational",
    name: "Educational",
    description: "Konten edukatif yang mengajarkan konsep, fakta, atau pengetahuan baru",
    objective: "educate",
    funnelStage: "awareness",
    audienceIntent: "learn",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["curiosity", "question", "data"]),
    compatibleStructures: JSON.stringify([
      "Hook-Fasilitas-Peak-CTA",
      "Problem-Solution-Fasilitas-CTA",
      "LongForm-Intro-Kamar-Fasilitas-Sekitar-Value-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 20,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "informational",
  },
  {
    id: "ct_howto",
    name: "How-to / Tutorial",
    description: "Panduan langkah-demi-langkah untuk melakukan sesuatu",
    objective: "educate",
    funnelStage: "consideration",
    audienceIntent: "learn",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube"]),
    recommendedHookFamilies: JSON.stringify(["problem", "question", "direct_benefit"]),
    compatibleStructures: JSON.stringify([
      "Problem-Solution-Fasilitas-CTA",
      "Hook-Fasilitas-Peak-CTA",
    ]),
    ctaTendencies: "medium",
    promotionalIntensity: 40,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "informational",
  },
  {
    id: "ct_listicle",
    name: "Listicle",
    description: "Konten berbentuk daftar (5 Tips, 10 Cara, dll)",
    objective: "engage",
    funnelStage: "awareness",
    audienceIntent: "explore",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["curiosity", "data", "comparison"]),
    compatibleStructures: JSON.stringify([
      "Hook-Fasilitas-Peak-CTA",
      "Hook-Peak-Fasilitas-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 30,
    evergreenSuitability: true,
    trendSuitability: true,
    category: "informational",
  },
  {
    id: "ct_storytelling",
    name: "Storytelling",
    description: "Konten naratif yang menceritakan kisah, pengalaman, atau perjalanan",
    objective: "engage",
    funnelStage: "consideration",
    audienceIntent: "explore",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["story", "mystery", "pattern_interrupt"]),
    compatibleStructures: JSON.stringify([
      "LongForm-POV-Kedatangan-Kamar-Fasilitas-Aktivitas-Malam-CTA",
      "Hook-Peak-Fasilitas-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 25,
    evergreenSuitability: true,
    trendSuitability: true,
    category: "engagement",
  },
  {
    id: "ct_problem_solution",
    name: "Problem-Solution",
    description: "Konten yang mengidentifikasi masalah dan menawarkan solusi",
    objective: "convert",
    funnelStage: "decision",
    audienceIntent: "solve",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["problem", "direct_benefit", "question"]),
    compatibleStructures: JSON.stringify([
      "Problem-Solution-Fasilitas-CTA",
      "Hook-Fasilitas-Peak-CTA",
    ]),
    ctaTendencies: "hard",
    promotionalIntensity: 70,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "promotional",
  },
  {
    id: "ct_myth_fact",
    name: "Myth vs Fact",
    description: "Konten yang membongkar mitos atau kesalahpahaman",
    objective: "educate",
    funnelStage: "awareness",
    audienceIntent: "learn",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["contrarian", "warning", "curiosity"]),
    compatibleStructures: JSON.stringify([
      "Hook-Peak-Fasilitas-CTA",
      "Problem-Solution-Fasilitas-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 20,
    evergreenSuitability: true,
    trendSuitability: true,
    category: "informational",
  },
  {
    id: "ct_comparison",
    name: "Comparison",
    description: "Konten yang membandingkan opsi, fitur, atau pilihan",
    objective: "educate",
    funnelStage: "consideration",
    audienceIntent: "compare",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["comparison", "question", "data"]),
    compatibleStructures: JSON.stringify([
      "Hook-Fasilitas-Peak-CTA",
      "Hook-Peak-Fasilitas-CTA",
    ]),
    ctaTendencies: "medium",
    promotionalIntensity: 50,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "informational",
  },
  {
    id: "ct_case_study",
    name: "Case Study",
    description: "Konten yang menampilkan contoh nyata, pengalaman tamu, atau hasil",
    objective: "convert",
    funnelStage: "decision",
    audienceIntent: "decide",
    suitablePlatforms: JSON.stringify(["instagram", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["story", "data", "direct_benefit"]),
    compatibleStructures: JSON.stringify([
      "LongForm-POV-Kedatangan-Kamar-Fasilitas-Aktivitas-Malam-CTA",
      "Hook-Peak-Fasilitas-CTA",
    ]),
    ctaTendencies: "hard",
    promotionalIntensity: 60,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "promotional",
  },
  {
    id: "ct_behind_scenes",
    name: "Behind the Scenes",
    description: "Konten yang menampilkan proses, persiapan, atau kehidupan sehari-hari",
    objective: "engage",
    funnelStage: "consideration",
    audienceIntent: "explore",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["curiosity", "story", "pattern_interrupt"]),
    compatibleStructures: JSON.stringify([
      "LongForm-POV-Kedatangan-Kamar-Fasilitas-Aktivitas-Malam-CTA",
      "Hook-Peak-Fasilitas-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 30,
    evergreenSuitability: true,
    trendSuitability: true,
    category: "engagement",
  },
  {
    id: "ct_product_showcase",
    name: "Product Showcase",
    description: "Konten yang menampilkan produk, layanan, atau fitur secara detail",
    objective: "convert",
    funnelStage: "decision",
    audienceIntent: "decide",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["direct_benefit", "data", "curiosity"]),
    compatibleStructures: JSON.stringify([
      "Hook-Fasilitas-Peak-CTA",
      "LongForm-Intro-Kamar-Fasilitas-Sekitar-Value-CTA",
    ]),
    ctaTendencies: "hard",
    promotionalIntensity: 80,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "promotional",
  },
  {
    id: "ct_testimonial",
    name: "Testimonial",
    description: "Konten yang menampilkan review, testimoni, atau pengalaman positif pelanggan",
    objective: "convert",
    funnelStage: "decision",
    audienceIntent: "decide",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["story", "direct_benefit", "data"]),
    compatibleStructures: JSON.stringify([
      "Hook-Peak-Fasilitas-CTA",
      "LongForm-POV-Kedatangan-Kamar-Fasilitas-Aktivitas-Malam-CTA",
    ]),
    ctaTendencies: "hard",
    promotionalIntensity: 70,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "promotional",
  },
  {
    id: "ct_faq",
    name: "FAQ",
    description: "Konten yang menjawab pertanyaan umum atau frequently asked questions",
    objective: "support",
    funnelStage: "consideration",
    audienceIntent: "learn",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["question", "problem", "direct_benefit"]),
    compatibleStructures: JSON.stringify([
      "Problem-Solution-Fasilitas-CTA",
      "Hook-Fasilitas-Peak-CTA",
    ]),
    ctaTendencies: "medium",
    promotionalIntensity: 40,
    evergreenSuitability: true,
    trendSuitability: false,
    category: "support",
  },
  {
    id: "ct_trend",
    name: "Trend / Reaction",
    description: "Konten yang mengikuti atau merespons tren, challenge, atau topik viral",
    objective: "engage",
    funnelStage: "awareness",
    audienceIntent: "explore",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube"]),
    recommendedHookFamilies: JSON.stringify(["pattern_interrupt", "curiosity", "story"]),
    compatibleStructures: JSON.stringify([
      "Hook-Peak-Fasilitas-CTA",
      "Hook-Fasilitas-Peak-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 20,
    evergreenSuitability: false,
    trendSuitability: true,
    category: "engagement",
  },
  {
    id: "ct_ugc",
    name: "UGC-style",
    description: "Konten gaya user-generated content, authentik dan natural",
    objective: "engage",
    funnelStage: "awareness",
    audienceIntent: "explore",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["story", "pattern_interrupt", "curiosity"]),
    compatibleStructures: JSON.stringify([
      "LongForm-POV-Kedatangan-Kamar-Fasilitas-Aktivitas-Malam-CTA",
      "Hook-Peak-Fasilitas-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 30,
    evergreenSuitability: true,
    trendSuitability: true,
    category: "engagement",
  },
  {
    id: "ct_promotional",
    name: "Promotional",
    description: "Konten promosi langsung dengan penawaran, diskon, atau call-to-action kuat",
    objective: "convert",
    funnelStage: "decision",
    audienceIntent: "decide",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["direct_benefit", "warning", "data"]),
    compatibleStructures: JSON.stringify([
      "Hook-Fasilitas-Peak-CTA",
      "Problem-Solution-Fasilitas-CTA",
    ]),
    ctaTendencies: "hard",
    promotionalIntensity: 100,
    evergreenSuitability: false,
    trendSuitability: true,
    category: "promotional",
  },
  {
    id: "ct_community",
    name: "Community / Engagement",
    description: "Konten yang membangun komunitas, interaksi, atau engagement dengan audiens",
    objective: "engage",
    funnelStage: "retention",
    audienceIntent: "explore",
    suitablePlatforms: JSON.stringify(["instagram", "tiktok", "youtube", "facebook"]),
    recommendedHookFamilies: JSON.stringify(["question", "story", "pattern_interrupt"]),
    compatibleStructures: JSON.stringify([
      "Hook-Peak-Fasilitas-CTA",
      "Hook-Fasilitas-Peak-CTA",
    ]),
    ctaTendencies: "soft",
    promotionalIntensity: 10,
    evergreenSuitability: true,
    trendSuitability: true,
    category: "engagement",
  },
];

async function seedContentTypes() {
  console.log("🌱 Seeding Content Type Taxonomy...\n");

  let inserted = 0;
  let skipped = 0;

  for (const type of SYSTEM_CONTENT_TYPES) {
    try {
      // Check if already exists
      const existing = await db
        .select()
        .from(contentTypes)
        .where(eq(contentTypes.id, type.id))
        .limit(1);

      if (existing.length > 0) {
        console.log(`⏭️  SKIP: ${type.name} (${type.id}) — already exists`);
        skipped++;
        continue;
      }

      // Insert
      await db.insert(contentTypes).values({
        ...type,
        createdAt: new Date(),
      });

      console.log(`✅ INSERTED: ${type.name} (${type.id})`);
      console.log(`   Category: ${type.category}, Objective: ${type.objective}`);
      console.log(`   Promotional Intensity: ${type.promotionalIntensity}/100`);
      inserted++;
    } catch (err) {
      console.error(`❌ FAILED: ${type.name} (${type.id}):`, err);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 SEED SUMMARY:`);
  console.log(`✅ Inserted: ${inserted}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📈 Total: ${SYSTEM_CONTENT_TYPES.length}`);

  if (inserted > 0) {
    console.log("\n🎉 Content Type Taxonomy seeded successfully!");
  } else {
    console.log("\n⚠️  No new types inserted (all already exist)");
  }
}

seedContentTypes()
  .then(() => {
    console.log("\n✅ Seed script complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Seed script failed:", err);
    process.exit(1);
  });
