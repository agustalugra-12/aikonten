import { db } from "@/db";
import { platformPolicies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

// Auto-enable Platform Policy (2026-08-08, PRD "YouTube Content & Monetization Safety
// System", Section 4 "Automatic YouTube Policy Activation") - prinsip intinya: aturan
// safety khusus platform TIDAK PERNAH jadi toggle manual user, harus otomatis aktif
// begitu brand connect akun platform itu. Dipanggil dari titik INSERT socialAccounts
// (baik jalur native OAuth - src/app/api/auth/youtube/callback/route.ts - maupun jalur
// Buffer - src/app/api/brands/[id]/social-accounts/route.ts), BUKAN dipanggil user dari
// UI mana pun.
//
// Baru ada profile konkret utk "youtube" sekarang (platform lain belum py aturan
// khusus apa pun per PRD ini) - platform lain tetap boleh manggil fungsi ini nanti
// kalau suatu saat py policy engine sendiri, tanpa perlu ubah signature.
const PLATFORM_PROFILES: Partial<Record<"instagram" | "facebook" | "tiktok" | "youtube", string>> = {
  youtube: "youtube_monetization_safe",
};

export async function ensurePlatformPolicyEnabled(
  brandId: string,
  platform: "instagram" | "facebook" | "tiktok" | "youtube"
): Promise<void> {
  const profile = PLATFORM_PROFILES[platform];
  if (!profile) return; // platform ini belum py policy engine - tidak ada apa pun yg perlu diaktifkan

  const now = new Date();
  const [existing] = await db
    .select()
    .from(platformPolicies)
    .where(and(eq(platformPolicies.brandId, brandId), eq(platformPolicies.platform, platform)));

  if (existing) {
    if (!existing.enabled || existing.profile !== profile) {
      await db
        .update(platformPolicies)
        .set({ enabled: true, profile, updatedAt: now })
        .where(eq(platformPolicies.id, existing.id));
    }
    return;
  }

  await db.insert(platformPolicies).values({
    id: newId("policy"),
    brandId,
    platform,
    enabled: true,
    profile,
    createdAt: now,
    updatedAt: now,
  });
}

// Belum ada endpoint disconnect/hapus socialAccounts di app ini sama sekali per
// 2026-08-08 (dicek langsung - tidak ada route DELETE di
// src/app/api/brands/[id]/social-accounts) - fungsi "disable saat disconnect" dari PRD
// Section 38 sengaja BELUM dibuat di sini krn tidak ada titik pemanggilan nyata utk
// diwire, bukan terlewat. Kalau fitur disconnect dibangun nanti, tinggal panggil
// db.update(platformPolicies).set({enabled:false,...}) di titik itu.
