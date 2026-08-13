import { db } from "@/db";
import { projects, brands, socialAccounts, mediaAssets, publishLogs, channelProfiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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
  // connected=false dikecualikan sepenuhnya (2026-08-09, lihat komentar schema.ts) -
  // akun yg soft-disconnect (mis. channel putus di sisi Buffer) tidak lagi dihitung di
  // accounts.length, jadi platform lain yg sehat bisa selesai "published" bersih tanpa
  // nyangkut nunggu akun yang memang belum bisa dicoba lagi.
  const rawAccounts = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.connected, true)));

  // Split-routing YouTube native vs Buffer (2026-08-10, permintaan Agus - "kadang yt
  // native membatasi jumlah upload, aku mau short ke buffer dan video panjang ke
  // native") - HANYA relevan kalau brand ini py 2 akun YouTube sekaligus (native DAN
  // Buffer, spt Animal Story & Co setelah insiden Shorts-vs-longform hari ini).
  // Shorts -> Buffer (volume tinggi, kuota native dihemat), long-form -> native
  // (terbukti hari ini native BERHASIL utk video panjang, Buffer JUSTRU gagal utk
  // channel dgn pembatasan tertentu). Brand dgn cuma 1 akun YouTube (mayoritas kasus)
  // TIDAK terpengaruh sama sekali - filter ini idle kalau youtubeAccounts.length <= 1.
  const youtubeAccounts = rawAccounts.filter((a) => a.platform === "youtube");
  let accounts = rawAccounts;
  if (youtubeAccounts.length > 1) {
    const preferredVia = project.contentFormat === "youtube_shorts" ? "buffer" : "native";
    const preferred = youtubeAccounts.find((a) => a.publishVia === preferredVia);
    if (preferred) {
      accounts = rawAccounts.filter((a) => a.platform !== "youtube" || a.id === preferred.id);
    }
  }

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

  // Idempotent per-akun (2026-08-07, permintaan Agus - "yang berhasil di uploud ke
  // tiktok saja sedangkan fb dan ig gagal agar nanti di uploud ulang") - fungsi ini
  // SEKARANG dipanggil ulang utk RETRY project "partial" (lihat cron/auto-publish.ts),
  // jadi WAJIB skip akun yg publishLogs-nya SUDAH "success" di percobaan sebelumnya -
  // supaya retry cuma menyentuh platform yg gagal, tidak pernah publish dobel ke
  // platform yg sudah berhasil.
  const existingLogs = await db.select().from(publishLogs).where(eq(publishLogs.projectId, projectId));
  const alreadySucceededAccountIds = new Set(
    existingLogs.filter((l) => l.status === "success").map((l) => l.socialAccountId)
  );

  // Kumpulkan hasil SEMUA akun dulu (2026-08-06, permintaan Agus - "report ai marketing
  // cukup sekali saja jangan ketiganya") - kirim SATU notifikasi ringkasan di akhir,
  // bukan 1 notifikasi terpisah per akun/platform di dalam loop (lihat formatPublish
  // SummaryNotification di telegram.ts).
  const notifyResults: Array<{ platform: string; success: boolean; postUrl?: string; error?: string }> = [];
  for (const account of accounts) {
    if (alreadySucceededAccountIds.has(account.id)) continue; // sudah sukses percobaan sebelumnya - jangan publish dobel

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
    //
    // Bug NYATA ditemukan 2026-08-10 (laporan Agus - publish Animal Story & Co gagal
    // "belum pernah di-connect lewat OAuth" padahal akunnya SUDAH tersambung via
    // Buffer) - blok ini SEBELUMNYA cuma cek `account.platform === "youtube"`, TIDAK
    // peduli publishVia - jadi akun YouTube APAPUN (native ATAU Buffer) dipaksa lewat
    // refresh token OAuth NATIVE, yang jelas gagal utk akun yang sama sekali tidak
    // pernah connect via jalur native (cuma py bufferChannelId). WAJIB cek publishVia
    // juga - refresh token cuma relevan/perlu utk jalur native.
    let accessToken = account.accessToken;
    if (account.platform === "youtube" && account.publishVia === "native") {
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

    const baseCaption = hashtags.length ? `${caption}\n\n${hashtags.map((h: string) => `#${h}`).join(" ")}` : caption;
    // Sinyal #Shorts (2026-08-10, fitur YT Shorts) - YouTube SEBENARNYA auto-deteksi
    // Shorts murni dari dimensi file (portrait/persegi) + durasi <=3 menit, video ini
    // SUDAH dirender portrait+<=60dtk (lihat processProject.ts isYoutubeShorts) jadi
    // otomatis kedeteksi TANPA tag ini juga - #Shorts di sini cuma sinyal TAMBAHAN yg
    // umum dipakai kreator utk bantu algoritma/discovery Shorts, HANYA relevan utk akun
    // YouTube (bukan platform lain yg dpt caption SAMA di loop ini).
    const outCaption =
      account.platform === "youtube" && project.contentFormat === "youtube_shorts" && !baseCaption.includes("#Shorts")
        ? `${baseCaption}\n\n#Shorts`
        : baseCaption;

    // YouTube title/categoryId (2026-08-10, ditemukan lewat INTROSPEKSI GraphQL Buffer
    // - metadata.youtube.title & categoryId "Required on create", lihat catatan lengkap
    // di buffer.ts) - title diambil dari BARIS PERTAMA caption ASLI (bukan outCaption
    // yg sudah ditambah hashtag/#Shorts) - konvensi SAMA dgn publishToYoutube native
    // (youtube.ts `caption.split("\n")[0]`), dibangun buildYoutubeCaption() di
    // processProject.ts jadi baris pertama SELALU judul. categoryId dari Editorial
    // Policy channel ini (channelProfiles, lihat ChannelProfileDialog.tsx) - fallback
    // "22" People & Blogs kalau channel belum eksplisit pilih.
    let youtubeTitle: string | undefined;
    let youtubeCategoryId: string | undefined;
    if (account.platform === "youtube") {
      youtubeTitle = caption.split("\n")[0]?.trim() || brandName;
      const [profile] = await db.select().from(channelProfiles).where(eq(channelProfiles.socialAccountId, account.id));
      youtubeCategoryId = profile?.youtubeCategoryId || "22";
    }

    const result = await publisher({
      videoUrl: finalVideo?.fileUrl,
      imageUrls: finalImages.map((a) => a.fileUrl),
      caption: outCaption,
      accessToken,
      platformAccountId: account.platformAccountId,
      accountUsername: account.username,
      bufferChannelId: account.bufferChannelId,
      platform: account.platform,
      brandName,
      thumbnailUrl: thumbnail?.fileUrl,
      youtubeTitle,
      youtubeCategoryId,
    });

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

    // Verifikasi async status publish SUNGGUHAN via Buffer (2026-08-13, bug NYATA -
    // lihat catatan lengkap di bufferAuth.ts verifyPublishSucceeded) - createPost()
    // "success" cuma berarti Buffer MENERIMA request, publish beneran bisa gagal
    // belakangan (status "error") tanpa sinyal apa pun ke kita. HANYA relevan utk jalur
    // Buffer (native publisher lain sudah sinkron/terkonfirmasi langsung) - tidak
    // di-await (background, sama pola dgn checkAndHandleDuplicate di buffer.ts).
    if (account.publishVia === "buffer" && result.success && result.platformPostId) {
      const { verifyPublishSucceeded } = await import("./bufferAuth");
      verifyPublishSucceeded({
        postId: result.platformPostId,
        publishLogId: logId,
        projectId,
        brandName,
        platformLabel: `${account.platform} (@${account.username})`,
        token: account.accessToken,
      }).catch((err) => {
        console.error("[orchestrate] Gagal verifikasi status publish:", err);
      });
    }

    notifyResults.push({
      platform: `${account.platform} (@${account.username})`,
      success: result.success,
      postUrl: result.postUrl,
      error: result.error,
    });
  }

  // Notif cuma kalau ADA yg benar2 dicoba run ini (bukan project yg semua akunnya
  // sudah sukses dari sebelumnya - seharusnya tidak pernah masuk sini krn cron retry
  // cuma manggil project "partial", tapi jaring pengaman tetap aman kalau dipanggil
  // manual di project yg sudah "published" penuh).
  if (notifyResults.length > 0) {
    await sendTelegramNotification(formatPublishSummaryNotification({ brandName, projectId, results: notifyResults }));
  }

  // Status akhir dihitung dari SEMUA publishLogs (lama + baru), bukan cuma anySuccess
  // run ini - "partial" (2026-08-07) kalau ADA yg sukses TAPI belum SEMUA akun, supaya
  // cron retry bisa nemuin & coba lagi platform yg masih gagal. "published" cuma kalau
  // BENAR2 semua akun sukses (dulu: 1 akun sukses saja sudah dianggap "published",
  // platform lain yg gagal jadi tidak pernah dicoba lagi).
  const finalLogs = await db.select().from(publishLogs).where(eq(publishLogs.projectId, projectId));
  const succeededIds = new Set(finalLogs.filter((l) => l.status === "success").map((l) => l.socialAccountId));
  const finalStatus =
    succeededIds.size === 0 ? "failed" : succeededIds.size === accounts.length ? "published" : "partial";

  await db
    .update(projects)
    .set({ status: finalStatus, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}
