import { db } from "@/db";
import { projects, brands, socialAccounts, mediaAssets, publishLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getPublisher } from "./index";
import { sendTelegramNotification, formatPublishNotification } from "./telegram";

// Full-auto publish (lihat PRD diskusi - Agus eksplisit minta ZERO keterlibatan manual,
// TIDAK ADA jeda approval sebelum publish). Dipanggil otomatis oleh process/route.ts
// begitu artefak AI (caption/hashtag/klip) selesai - BUKAN tombol terpisah yang perlu
// diklik manual. Notifikasi Telegram (bukan approval gate) jadi satu-satunya jaring
// pengaman, dikirim tiap kali ada percobaan publish, sukses maupun gagal.
export async function publishProject(projectId: string): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return;

  const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));
  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.brandId, project.brandId));

  const assets = await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, projectId));
  const finalVideo = assets.find((a) => a.type === "final_video");
  const finalImages = assets.filter((a) => a.type === "final_image");

  const brandName = brand?.name || "Brand";
  const caption = project.generatedCaption || "";
  const hashtags = project.generatedHashtags ? JSON.parse(project.generatedHashtags) : [];

  // Belum ada video/gambar FINAL (rendering trim+concat+subtitle via Cloudinary/
  // Replicate belum diimplementasikan - lihat task terpisah) - tidak ada yang bisa
  // dipublikasikan, tapi tetap dicatat & dinotifikasi sbg kegagalan yang JELAS
  // alasannya, bukan diam-diam tidak terjadi apa-apa.
  if (!finalVideo && finalImages.length === 0) {
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: "Belum ada aset final (video/gambar) utk dipublikasikan", updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    await sendTelegramNotification(
      `⚠️ <b>${brandName}</b> - project ${projectId} siap secara teks (caption/hashtag) ` +
        `tapi rendering video/gambar final BELUM tersedia, publish dibatalkan.`
    );
    return;
  }

  if (accounts.length === 0) {
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: "Brand ini belum punya akun sosmed terhubung", updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    return;
  }

  await db.update(projects).set({ status: "publishing", updatedAt: new Date() }).where(eq(projects.id, projectId));

  let anySuccess = false;
  for (const account of accounts) {
    const publisher = getPublisher(account.platform, account.publishVia);
    const logId = newId("pub");
    if (!publisher) {
      await db.insert(publishLogs).values({
        id: logId,
        projectId,
        socialAccountId: account.id,
        status: "failed",
        errorMessage: `Tidak ada publisher utk ${account.platform}/${account.publishVia}`,
        createdAt: new Date(),
      });
      continue;
    }

    const result = await publisher({
      videoUrl: finalVideo?.fileUrl,
      imageUrls: finalImages.map((a) => a.fileUrl),
      caption: hashtags.length ? `${caption}\n\n${hashtags.map((h: string) => `#${h}`).join(" ")}` : caption,
      accessToken: account.accessToken,
      platformAccountId: account.platformAccountId,
      accountUsername: account.username,
      bufferChannelId: account.bufferChannelId,
    });

    if (result.success) anySuccess = true;

    await db.insert(publishLogs).values({
      id: logId,
      projectId,
      socialAccountId: account.id,
      status: result.success ? "success" : "failed",
      platformPostId: result.platformPostId || null,
      errorMessage: result.error || null,
      telegramNotifiedAt: new Date(),
      publishedAt: result.success ? new Date() : null,
      createdAt: new Date(),
    });

    await sendTelegramNotification(
      formatPublishNotification({
        brandName,
        projectId,
        platform: `${account.platform} (@${account.username})`,
        success: result.success,
        postUrl: result.postUrl,
        error: result.error,
      })
    );
  }

  await db
    .update(projects)
    .set({ status: anySuccess ? "published" : "failed", updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}
