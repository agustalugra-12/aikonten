import { db } from "@/db";
import { projects, brands, socialAccounts, mediaAssets, publishLogs, channelProfiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getPublisher } from "./index";
import { sendTelegramNotification, formatPublishSummaryNotification } from "./telegram";
import { ensureFreshYoutubeAccessToken } from "./youtubeAuth";
import { tryAcquireLock, releaseLock, projectPublishLockKey, LockBusyError } from "@/lib/concurrency/locks";
import { adaptCaptionForPlatform, type Platform } from "@/lib/ai/platformAdaptation";

// Publish - dulu dipanggil OTOMATIS begitu artefak AI selesai (full-auto, tanpa jeda
// approval), TAPI sejak 2026-08-04 (permintaan Agus - mau bisa cek draft dulu) ini
// SEKARANG cuma dipanggil MANUAL: sekali dari draft review (DraftReview.tsx, tombol
// "Publikasikan") setelah Agus approve, atau sbg retry manual kalau publish
// sebelumnya gagal. Notifikasi Telegram tetap dikirim tiap percobaan publish, sukses
// maupun gagal, sbg jaring pengaman tambahan (bukan approval gate lagi - itu sudah di
// tahap draft review).
async function publishProjectInner(projectId: string, opts?: { accountIds?: string[]; captionOverride?: string }): Promise<void> {
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

  // Pilih kanal (2026-10-05, upload modal) - kalau owner memilih subset akun, publish
  // HANYA ke akun itu (tetap intersect dgn yg connected di atas). Kosong/undefined = semua.
  if (opts?.accountIds && opts.accountIds.length > 0) {
    const want = new Set(opts.accountIds);
    accounts = accounts.filter((a) => want.has(a.id));
  }

  const assets = await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, projectId));
  const finalVideo = assets.find((a) => a.type === "final_video");
  const finalImages = assets.filter((a) => a.type === "final_image");
  const thumbnail = assets.find((a) => a.type === "thumbnail");

  const brandName = brand?.name || "Brand";
  // Upload modal (2026-10-05) - owner bisa edit caption & pilih kanal sebelum publish.
  // captionOverride = teks final owner (hashtag TIDAK di-append lagi, owner sudah atur
  // sendiri di modal). Tanpa override = perilaku lama (caption+hashtag dari project).
  const caption = (opts?.captionOverride ?? project.generatedCaption) || "";
  const hashtags = opts?.captionOverride ? [] : (project.generatedHashtags ? JSON.parse(project.generatedHashtags) : []);

  // Caption Only (2026-09-12) - project teks-saja (type "caption", tanpa media). Jalur
  // publish teks ADITIF: lewati cek media-wajib di bawah, dan di loop skip platform yg
  // mensyaratkan media (IG/TikTok/YouTube) - hanya kirim teks ke platform text-capable
  // (Facebook / kanal Buffer). Jalur media existing 100% tidak berubah.
  const isCaption = project.type === "caption";
  const CAPTION_MEDIA_REQUIRED = new Set(["instagram", "tiktok", "youtube"]);

  // Belum ada video/gambar FINAL (rendering trim+concat+subtitle via Cloudinary/
  // Replicate belum diimplementasikan - lihat task terpisah) - tidak ada yang bisa
  // dipublikasikan, tapi tetap dicatat & dinotifikasi sbg kegagalan yang JELAS
  // alasannya, bukan diam-diam tidak terjadi apa-apa.
  if (!isCaption && !finalVideo && finalImages.length === 0) {
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: "Belum ada aset final (video/gambar) utk dipublikasikan", updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    // try/catch (2026-09-07, sama pengamanan dgn notif ringkasan di bawah) - status DB
    // sudah "failed" di atas SEBELUM notif ini, jadi tidak kritis spt kasus notif
    // ringkasan, tapi tetap dijaga konsisten - notifikasi gagal kirim tidak boleh jadi
    // unhandled exception yg merambat ke pemanggil (cron/manual publish).
    try {
      await sendTelegramNotification(
        `⚠️ <b>${brandName}</b> - project ${projectId} siap secara teks (caption/hashtag) ` +
          `tapi rendering video/gambar final BELUM tersedia, publish dibatalkan.`
      );
    } catch (err) {
      console.error(`[orchestrate] Gagal kirim notifikasi Telegram (project ${projectId} tetap ditandai failed):`, err);
    }
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

    // Caption Only: platform yg wajib media (IG/TikTok/YouTube) tidak bisa terima post
    // teks-saja - skip dgn alasan JELAS (dicatat), lanjut akun berikutnya.
    if (isCaption && CAPTION_MEDIA_REQUIRED.has(account.platform)) {
      await db.insert(publishLogs).values({
        id: newId("pub"),
        projectId,
        socialAccountId: account.id,
        status: "failed",
        errorMessage: `Post teks-saja tidak didukung ${account.platform} (butuh media) - dilewati`,
        createdAt: new Date(),
      });
      notifyResults.push({
        platform: `${account.platform} (@${account.username})`,
        success: false,
        error: "teks-saja tidak didukung platform ini (butuh media)",
      });
      continue;
    }

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
    //
    // Platform Adaptation (PRD §43) - adapt caption ke gaya platform berbeda.
    // TikTok: hook + retention + fast pacing, Instagram: visual + saves, dst.
    const platformKey = (account.platform || "instagram").toLowerCase() as Platform;
    let outCaption: string;
    if (platformKey === "youtube") {
      // YouTube: tambahkan #Shorts kalau konten shorts (simple rule, tidak perlu AI)
      outCaption = project.contentFormat === "youtube_shorts" && !baseCaption.includes("#Shorts")
        ? `${baseCaption}\n\n#Shorts`
        : baseCaption;
    } else {
      // Platform lain: adapt via AI
      outCaption = await adaptCaptionForPlatform(baseCaption, platformKey, brandName);
    }

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
    //
    // Skip utk Instagram (2026-09-02, optimasi jatah Buffer 30 hari - brand Laundry In
    // Bali kena RATE_LIMIT_EXCEEDED window 30d) - komentar bufferAuth.ts sendiri sudah
    // catat BUKTI nyata "Instagram biasa 'sent' dlm hitungan detik", beda dari TikTok
    // yang terbukti (insiden nyata 2026-08-13) bisa "sending" 15-17 menit & kadang
    // berakhir "error" diam-diam. Coverage TikTok TIDAK dikurangi sama sekali - cuma
    // hapus polling yang costnya nyata tapi manfaatnya sudah terbukti nol utk Instagram.
    const BUFFER_VERIFY_SKIP_PLATFORMS = new Set(["instagram"]);
    if (
      account.publishVia === "buffer" &&
      result.success &&
      result.platformPostId &&
      !BUFFER_VERIFY_SKIP_PLATFORMS.has(account.platform)
    ) {
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
  //
  // try/catch (2026-09-07, bug KRITIS nyata ditemukan - laporan Agus "AI konten semua
  // gagal upload"): panggilan ini TIDAK PERNAH dibungkus try/catch, jadi begitu
  // Telegram API timeout/network gagal (nyata terjadi 2x hari ini,
  // ConnectTimeoutError ke 149.154.166.110), exception-nya MERAMBAT KELUAR dan
  // MENGGAGALKAN SISA FUNGSI INI - termasuk penghitungan finalStatus & update
  // projects.status di bawah TIDAK PERNAH jalan. Dicek langsung ke DB: proj_znjTrcP0OmOn
  // publish-nya SUKSES PENUH ke kedua akun sosmed Harmoni (publishLogs status=success,
  // platform_post_id terisi) TAPI projects.status nyangkut selamanya di "publishing" &
  // cron melaporkannya "publish gagal" - laporan Agus jadi salah total (konten SUDAH
  // tayang, bukan gagal). Pola pengamanan SAMA dgn verifyPublishSucceeded beberapa
  // baris di atas (notifikasi/verifikasi tambahan tidak boleh menggagalkan alur utama)
  // - HANYA belum diterapkan konsisten di panggilan notifikasi RINGKASAN ini.
  if (notifyResults.length > 0) {
    try {
      await sendTelegramNotification(formatPublishSummaryNotification({ brandName, projectId, results: notifyResults }));
    } catch (err) {
      console.error(`[orchestrate] Gagal kirim notifikasi ringkasan Telegram (publish project ${projectId} TETAP lanjut diproses):`, err);
    }
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

// Lock per-projectId (2026-08-14, temuan #2 Lampiran D ENGINEERING_SAFETY.md / audit
// kontenpilot §4/§6) - publishProjectInner()'s idempotency di atas (alreadySucceededAccountIds,
// baris ~90) itu READ-THEN-ACT tanpa lock - 2 panggilan bersamaan (klik dobel tombol
// "Publikasikan", atau retry manual balapan dgn cron auto-publish 15-menit utk project
// yg sama) bisa SAMA-SAMA lolos cek "belum sukses" SEBELUM salah satu insert publishLogs,
// keduanya coba publish ke akun sosial media yg SAMA -> DOBEL-PUBLISH sungguhan ke akun
// live (TikTok/IG/YT/FB) - susah di-undo diam-diam, beda dari dobel-render (biaya doang).
// Registry SAMA dgn lock project-process (lib/concurrency/locks.ts) tapi PREFIX KEY BEDA
// ("project-publish:" vs "project-process:") - render & publish 2 tahap yg biasanya
// tidak overlap (publish baru jalan stlh status "ready"), sengaja tidak disatukan supaya
// 1 tahap tidak pernah tanpa sengaja mem-block tahap lain yg independen.
//
// Caller manual (publish/route.ts, retry/route.ts) map LockBusyError -> 409 jelas.
// Caller cron (auto-publish/route.ts, 2 titik: slot publish & retryPartialPublishes)
// SUDAH py try/catch per-project yg log & lanjut ke project berikutnya - LockBusyError
// otomatis "skip bersih" lewat jalur itu tanpa perlu ubah kode di sana (busy = akan
// dicoba lagi di siklus cron 15-menit berikutnya, bukan hilang).
export async function publishProject(projectId: string, opts?: { accountIds?: string[]; captionOverride?: string }): Promise<void> {
  const lockKey = projectPublishLockKey(projectId);
  if (!tryAcquireLock(lockKey)) {
    throw new LockBusyError(
      lockKey,
      "Project ini sedang dipublikasikan oleh proses lain - tunggu sampai selesai sebelum mencoba lagi."
    );
  }
  try {
    await publishProjectInner(projectId, opts);
  } finally {
    releaseLock(lockKey);
  }
}
