import { db } from "@/db";
import { projects, brands, socialAccounts, mediaAssets, publishLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getPublisher } from "./index";
import { sendTelegramNotification, formatPublishSummaryNotification } from "./telegram";
import { ensureFreshYoutubeAccessToken } from "./youtubeAuth";

// Publish - dulu dipanggil OTOMATIS begitu artefak AI selesai (full-auto, tanpa jeda
// approval), TAPI sejak 2026-08-04 (permintaan Agus - mau bisa cek draft dulu) ini
// SEKARANG cuma dipanggil MANUAL: sekali dari draft review (DraftReview.tsx, tombol
// "Publikasikan") setelah Agus approve, atau sbg retry manual kalau publish
// sebelumnya gagal. Notifikasi Telegram tetap dikirim tiap percobaan publish, sukses
// maupun gagal, sbg jaring pengaman tambahan (bukan approval gate lagi - itu sudah di
// tahap draft review).
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
  const thumbnail = assets.find((a) => a.type === "thumbnail");

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

  // Kumpulkan hasil SEMUA akun dulu (2026-08-06, permintaan Agus - "report ai marketing
  // cukup sekali saja jangan ketiganya") - kirim SATU notifikasi ringkasan di akhir,
  // bukan 1 notifikasi terpisah per akun/platform di dalam loop (lihat formatPublish
  // SummaryNotification di telegram.ts).
  const notifyResults: Array<{ platform: string; success: boolean; postUrl?: string; error?: string }> = [];
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
      notifyResults.push({
        platform: `${account.platform} (@${account.username})`,
        success: false,
        error: `Tidak ada publisher utk ${account.platform}/${account.publishVia}`,
      });
      continue;
    }

    // YouTube access token cuma berlaku ~1 jam - krn publish full otomatis (tidak ada
    // langkah manual sblm ini), refresh dulu pakai refresh_token kalau perlu, JANGAN
    // asumsi accessToken yg tersimpan masih hidup (lihat youtubeAuth.ts).
    let accessToken = account.accessToken;
    if (account.platform === "youtube") {
      try {
        accessToken = await ensureFreshYoutubeAccessToken(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.insert(publishLogs).values({
          id: logId,
          projectId,
          socialAccountId: account.id,
          status: "failed",
          errorMessage: message,
          telegramNotifiedAt: new Date(),
          createdAt: new Date(),
        });
        notifyResults.push({ platform: `${account.platform} (@${account.username})`, success: false, error: message });
        continue;
      }
    }

    const result = await publisher({
      videoUrl: finalVideo?.fileUrl,
      imageUrls: finalImages.map((a) => a.fileUrl),
      caption: hashtags.length ? `${caption}\n\n${hashtags.map((h: string) => `#${h}`).join(" ")}` : caption,
      accessToken,
      platformAccountId: account.platformAccountId,
      accountUsername: account.username,
      bufferChannelId: account.bufferChannelId,
      platform: account.platform,
      brandName,
      thumbnailUrl: thumbnail?.fileUrl,
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

    notifyResults.push({
      platform: `${account.platform} (@${account.username})`,
      success: result.success,
      postUrl: result.postUrl,
      error: result.error,
    });
  }

  if (notifyResults.length > 0) {
    await sendTelegramNotification(formatPublishSummaryNotification({ brandName, projectId, results: notifyResults }));
  }

  await db
    .update(projects)
    .set({ status: anySuccess ? "published" : "failed", updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}
