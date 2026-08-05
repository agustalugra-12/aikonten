import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { transcribeFootage } from "@/lib/ai/transcribe";
import {
  selectClips,
  scoreSegments,
  MAX_CLIP_DURATION,
  computeFootageBudgets,
  MIN_VIDEO_DURATION_SECONDS,
} from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, generateCaptionForImages, buildCaptionSrt } from "@/lib/ai/generateContent";
// Render video LOKAL via FFmpeg (2026-08-05, permintaan Agus - "migrasi agar prosesnya
// free") - GANTI dari cloudinary.ts (makan kredit berbayar) ke ffmpeg.ts (gratis, pakai
// CPU server sendiri). Signature SAMA PERSIS, cuma ganti sumber import.
import { renderFinalVideo } from "@/lib/render/ffmpeg";
import { applyPromoOverlay } from "@/lib/ai/promoOverlay";
import { generatePosterCopy } from "@/lib/ai/posterCopy";
import { applyPosterDesign } from "@/lib/ai/posterDesign";
import { generateThumbnail } from "@/lib/ai/thumbnail";
import { searchBrollVideo } from "@/lib/assets/broll";
import { fetchDestinationBrollClips, isDestinationContent } from "@/lib/ai/destinationBroll";
import { getRecentlyUsedFootageUrls, getRemoteFileSizeBytes, MAX_FOOTAGE_BYTES } from "@/lib/ai/footageVariety";
import { applyLogoToImage } from "@/lib/ai/logoOverlay";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { newId } from "@/lib/ids";

export type ProcessResult = {
  caption: string;
  hashtags: string[];
  promoText?: string | null;
  photoCount?: number;
  clipCount?: number;
  structureTemplate?: string;
};

// Deteksi footage stok Pexels/Pixabay via domain URL, BUKAN kolom DB baru (2026-08-04,
// permintaan Agus - fallback "generate tetap jalan walau tidak ada footage asli", lihat
// auto-content/route.ts) - pragmatis, hindari migrasi skema utk 1 fitur ini. Footage stok
// TIDAK PUNYA ucapan asli yg relevan buat ditranskrip (beda dari footage Pelangi/Harmoni
// sendiri yg suara aslinya jadi dasar pemilihan klip) - jadi transcribeFootage+selectClips
// di-SKIP total, diganti 1 segmen sintetis yg mencakup seluruh klip (durasi asli dari
// broll.durationSeconds, disimpan ke mediaAssets.durationSeconds saat insert - lihat
// auto-content/route.ts). AI Dubbing (sudah ada) tetap jalan spt biasa & GANTI TOTAL audio
// asli klip stok dgn TTS baca caption - jadi tidak masalah klip stok tidak ada ucapan.
const STOCK_FOOTAGE_DOMAINS = ["pexels.com", "pixabay.com"];
const STOCK_FOOTAGE_MAX_DURATION = 20; // detik - jaga video tetap gaya konten pendek/reels

function isStockFootageUrl(url: string): boolean {
  return STOCK_FOOTAGE_DOMAINS.some((domain) => url.includes(domain));
}

// Pipeline Fase 1 (lihat memory proyek) - DIPAKAI BERSAMA oleh
// POST /api/projects/[id]/process (dipicu manual dari NewProjectDialog) MAUPUN
// POST /api/brands/[id]/auto-content ("⚡ Konten Otomatis", lihat matchFootageBank.ts)
// - SATU implementasi, bukan duplikat kode. Dua jalur beda tergantung project.type:
// - "video": transkripsi -> pemilihan klip otomatis (heuristik deterministik, BUKAN
//   vision-AI) -> caption/hashtag/subtitle -> render video final (splice+subtitle via
//   Cloudinary) -> thumbnail (kalau ada YouTube) -> publish.
// - "carousel" (foto): TIDAK ada transkrip/render - foto mentah LANGSUNG jadi aset
//   final, caption dibuat dari analisis foto asli (vision model).
// Keduanya BERHENTI di status "ready" (draft) - TIDAK publish otomatis lagi
// (2026-08-04, permintaan Agus: mau bisa cek draft dulu sebelum tayang - lihat
// DraftReview.tsx). publishProject() sekarang HANYA dipanggil manual lewat tombol
// "Publikasikan" di draft review (POST /api/projects/[id]/publish).
export async function processProject(id: string): Promise<ProcessResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw new Error("Project tidak ditemukan");

  try {
    if (!project.script) throw new Error("Project belum punya script/brief");

    const rawFootageAssets = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.type, "raw_footage")));
    if (rawFootageAssets.length === 0) throw new Error("Belum ada footage mentah utk project ini");
    // jalur video BISA >1 file sekaligus (2026-08-05, permintaan Agus - "dominasi footage
    // Pelangi" perlu digabung dari beberapa klip, 1 file asli sering terlalu pendek
    // sendirian) - lihat pooling multi-source di bawah. rawFootage (tunggal) tetap dipakai
    // sbg representatif utk thumbnail & cek stok-atau-tidak.
    const [rawFootage] = rawFootageAssets;

    const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));

    if (project.type === "carousel") {
      const photoUrls = rawFootageAssets.map((a) => a.fileUrl);
      const { caption, hashtags, promoText, pillar, angle, targetKeyword, keywordLevel } = await generateCaptionForImages(
        brand?.name || "Brand",
        project.script,
        photoUrls,
        brand?.knowledgeSite
      );

      // Foto TUNGGAL pakai "Pelangi Homestay Poster Design System v1" (2026-08-05, master
      // prompt lengkap dari Agus) - poster penuh (headline/CTA/badge/benefit dgn gaya
      // brand konsisten), BUKAN cuma badge kecil 1 pojok - lihat posterDesign.ts. Carousel
      // multi-foto TETAP pakai applyPromoOverlay lama (badge kecil di foto pertama SAJA
      // kalau ada promo) - master prompt ini eksplisit "hanya untuk single foto".
      const finalImageUrls =
        photoUrls.length === 1
          ? [
              await applyPosterDesign({
                brandId: project.brandId,
                projectId: id,
                imageUrl: photoUrls[0],
                copy: await generatePosterCopy(brand?.name || "Brand", project.script),
              }),
            ]
          : await Promise.all(
              photoUrls.map((url, i) =>
                promoText && i === 0
                  ? applyPromoOverlay({ brandId: project.brandId, projectId: id, imageUrl: url, promoText })
                  : Promise.resolve(url)
              )
            );

      // Logo brand OPSIONAL (2026-08-05, permintaan Agus) - lingkaran, proporsional,
      // ditempel di SETIAP foto final (poster tunggal MAUPUN carousel) - dilewati
      // begitu saja kalau brand belum punya logoUrl.
      const brandedImageUrls = brand?.logoUrl
        ? await Promise.all(
            finalImageUrls.map(async (url, i) => {
              const buffer = await applyLogoToImage(url, brand.logoUrl!);
              const key = buildAssetKey(project.brandId, id, `logo_${i}.png`);
              return uploadBuffer(key, buffer, "image/png");
            })
          )
        : finalImageUrls;

      await db
        .update(projects)
        .set({
          status: "ready",
          generatedCaption: caption,
          generatedHashtags: JSON.stringify(hashtags),
          pillar,
          angle,
          targetKeyword,
          keywordLevel,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));

      // Foto tunggal SELALU tetap poster foto (2026-08-05, permintaan Agus - single
      // post harus pakai foto asli apa adanya + overlay teks promo kalau ada, BUKAN
      // diubah jadi video) - sama persis carousel multi-foto di bawah, tidak ada lagi
      // percabangan khusus foto tunggal. Efek zoom-ke-video (applyZoomToImage) yang
      // dulu otomatis jalan di sini sudah DIHAPUS dari alur ini per keputusan Agus ini
      // (supersede keputusan sebelumnya "bangun untuk foto saja" - Ken Burns zoom).
      for (const url of brandedImageUrls) {
        await db.insert(mediaAssets).values({
          id: newId("asset"),
          projectId: id,
          type: "final_image",
          fileUrl: url,
          durationSeconds: null,
          createdAt: new Date(),
        });
      }

      return { caption, hashtags, promoText, photoCount: brandedImageUrls.length };
    }

    const isStockFootage = rawFootageAssets.every((a) => isStockFootageUrl(a.fileUrl));

    type SourcedSegment = Awaited<ReturnType<typeof selectClips>>[number] & { sourceUrl: string };
    let segments: Awaited<ReturnType<typeof transcribeFootage>>;
    let selected: SourcedSegment[];
    let selectedText: string;
    // Pool transkrip LENGKAP (semua segmen, bukan cuma yg terpilih) - diisi di cabang
    // non-stok, dipakai lagi belakangan utk top-up minimum durasi 40 detik (lihat
    // MIN_VIDEO_DURATION_SECONDS di bawah) kalau seleksi awal masih kurang.
    let pooled: (Awaited<ReturnType<typeof transcribeFootage>>[number] & { sourceUrl: string })[] = [];

    if (isStockFootage) {
      const cappedDuration = Math.min(rawFootage.durationSeconds || 8, STOCK_FOOTAGE_MAX_DURATION);
      segments = [];
      selected = [
        {
          start: 0,
          end: cappedDuration,
          text: "",
          avgLogprob: 0,
          keywordScore: 0,
          clarityScore: 0,
          durationScore: 0,
          combinedScore: 0,
          sourceUrl: rawFootage.fileUrl,
        },
      ];
      // Tidak ada transkrip asli - caption/hashtag digenerate dari SKRIP/IDE saja (masih
      // cukup, krn ini jalur ide UMUM yg tidak butuh detail spesifik properti).
      selectedText = "";
    } else {
      // Skip footage yg kelewat panjang/besar SEBELUM transkripsi (lihat catatan
      // MAX_FOOTAGE_BYTES di atas) - cek size via HEAD dulu (murah, tidak perlu download
      // penuh), JANGAN coba-coba transkripsi lalu gagal di tengah pipeline (bug nyata yg
      // ditemukan sblm larangan ini ada).
      const sizeChecked = await Promise.all(
        rawFootageAssets.map(async (asset) => ({ asset, size: await getRemoteFileSizeBytes(asset.fileUrl) }))
      );
      const oversized = sizeChecked.filter((s) => s.size !== null && s.size > MAX_FOOTAGE_BYTES);
      const usableAssets = sizeChecked
        .filter((s) => s.size === null || s.size <= MAX_FOOTAGE_BYTES)
        .map((s) => s.asset);
      if (oversized.length > 0) {
        console.warn(
          `[processProject] skip footage terlalu panjang/besar (>24MB), TIDAK dipakai: ${oversized
            .map((s) => `${s.asset.fileUrl} (${Math.round((s.size || 0) / 1024 / 1024)}MB)`)
            .join(", ")}`
        );
      }
      if (usableAssets.length === 0) {
        throw new Error(
          "Semua footage yg diupload terlalu panjang/besar (>24MB) - potong dulu jadi beberapa klip pendek (beberapa detik tiap klip), jangan upload 1 video panjang."
        );
      }

      // Kumpulkan footage dari SEMUA file asli sekaligus (2026-08-05, permintaan Agus -
      // "1 video didominasi footage Pelangi", rasio 7:3 - 1 file asli sendirian sering
      // terlalu pendek [ada yg cuma ~4 detik] utk isi 70% dari target 30-60 detik).
      // Transkrip tiap file terpisah, tandai asal file-nya (sourceUrl) supaya
      // renderFinalVideo tahu tiap klip terpilih harus dipotong dari file MANA.
      segments = [];
      for (const asset of usableAssets) {
        const t = await transcribeFootage(asset.fileUrl);
        segments = segments.concat(t);
        pooled.push(...t.map((s) => ({ ...s, sourceUrl: asset.fileUrl })));
      }
      // Rasio asli:Pexels TERGANTUNG jenis konten (2026-08-05, permintaan Agus - "jika
      // konten wisata dekat pelangi homestay pakai footage pexels 60% footage pelangi
      // 40%", KEBALIKAN dari rasio default 7:3 utk video promosi properti biasa - lihat
      // computeFootageBudgets di clipSelect.ts).
      const footageBudgets = computeFootageBudgets(isDestinationContent(project.script));
      const budgeted = selectClips(pooled, project.script, footageBudgets.realBudgetSeconds);
      // Pastikan SEMUA file yg Agus sediakan ikut terwakili (2026-08-05, bug nyata
      // ditemukan lewat tes live - selectClips cuma fallback ke 1 klip TERBAIK dari
      // SELURUH pool kalau tidak ada yg lolos ambang skor, bukan per-file - 4 klip asli
      // disediakan tapi cuma 1 yg kepakai krn footage lain tanpa narasi jelas semuanya
      // kalah skor dari yg 1 itu). Video yg "didominasi footage Pelangi" (permintaan
      // Agus) HARUS menyertakan tiap file yg disediakan, bukan cuma yg skornya
      // kebetulan tertinggi - top-up klip terbaik PER FILE yg belum terwakili di hasil
      // selectClips.
      const representedSources = new Set(budgeted.map((s) => s.sourceUrl));
      const missingSources = usableAssets.filter((a) => !representedSources.has(a.fileUrl));
      const topUps = missingSources
        .map((asset) => {
          const ownSegments = pooled.filter((s) => s.sourceUrl === asset.fileUrl);
          if (ownSegments.length === 0) return null;
          const best = scoreSegments(ownSegments, project.script!).sort(
            (a, b) => b.combinedScore - a.combinedScore
          )[0];
          return { ...best, end: Math.min(best.end, best.start + MAX_CLIP_DURATION) };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const withTopUps = [...budgeted, ...topUps];
      // Struktur Hook -> Fasilitas (2026-08-05, permintaan Agus - "hook, peak, fasilitas,
      // cta"): klip skor TERTINGGI ditaruh PALING DEPAN sbg hook (paling "menjual" di 2-5
      // detik pertama, krusial utk retensi penonton short-form), sisanya diurutkan per
      // sumber file (bukan skor) supaya alur tiap klip dari file yg sama tetap kronologis
      // wajar, bukan loncat-loncat. Klip Pexels (destinationBroll, di bawah) jadi "peak" -
      // ditempel SETELAH bagian fasilitas ini, lihat renderFinalVideo (brollClips selalu
      // di akhir urutan).
      const [hook, ...restByScore] = [...withTopUps].sort((a, b) => b.combinedScore - a.combinedScore);
      const rest = restByScore.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl) || a.start - b.start);
      selected = hook ? [hook, ...rest] : rest;
      selectedText = selected.map((s) => s.text).join(" ");
    }
    const { caption, hashtags, brollKeywords, thumbnailText, structureTemplate, pillar, angle, targetKeyword, keywordLevel } = await generateCaptionAndHashtags(
      brand?.name || "Brand",
      project.script,
      selectedText,
      brand?.knowledgeSite
    );

    // Kombinasi footage asli + Pexels (2026-08-05, permintaan Agus - "jika ada
    // pembahasan wisata seperti danau beratan kebun raya bedugul dan lainnya gunakan
    // pexels, jika menyangkut pelangi gunakan footage asli pelangi", rasio 7:3). Cuma
    // relevan kalau dasarnya footage ASLI (bukan footage stok - video "ide umum" tanpa
    // footage asli, lihat isStockFootage di atas, sudah 100% Pexels dari awal, tidak ada
    // yg perlu dikombinasi). Tiap landmark yg disebut skrip dapat klip Pexels sendiri,
    // ditempel sbg "peak"/highlight SETELAH bagian fasilitas footage asli (lihat
    // renderFinalVideo - brollClips selalu di akhir urutan splice).
    // Anti-monoton (2026-08-05, permintaan Agus - "footage pexels jangan monoton,
    // TikTok anggap konten berulang, ini penting sekali") - kumpulkan url footage asli
    // MAUPUN klip Pexels/Pixabay yg BARU dipakai brand ini (5 project video terakhir,
    // lihat footageVariety.ts), diteruskan ke pencarian B-roll di bawah supaya klip yg
    // sama tidak kepilih lagi persis di video berikutnya.
    const recentlyUsedUrls = await getRecentlyUsedFootageUrls(project.brandId);

    let brollClips: Array<{ videoUrl: string; durationSeconds: number }> = [];
    if (!isStockFootage) {
      const stockBudget = computeFootageBudgets(isDestinationContent(project.script)).stockBudgetSeconds;
      brollClips = await fetchDestinationBrollClips(project.script, stockBudget, recentlyUsedUrls);
    }
    if (brollClips.length === 0 && brollKeywords) {
      // Fallback lama - skrip tidak menyebut landmark spesifik apa pun, tetap kasih 1
      // klip suasana umum spt sebelumnya (mis. "tropical homestay garden").
      const broll = await searchBrollVideo(brollKeywords, recentlyUsedUrls);
      if (broll) {
        brollClips = [{ videoUrl: broll.videoUrl, durationSeconds: Math.min(broll.durationSeconds, 5) }];
      }
    }

    // Aturan KERAS (2026-08-05, permintaan Agus - "aturan konten video tidak boleh
    // kurang dari 40 detik") - BEDA dari VIDEO_DURATION_TARGET (itu cuma titik tengah
    // rencana budget SEBELUM tau durasi klip sungguhan - klip asli sering lebih pendek
    // dari nominal MAX_CLIP_DURATION, bug durasi berulang sebelumnya justru dari sini).
    // Top-up di SINI pakai durasi SUNGGUHAN (bukan estimasi), prioritas: (1) footage
    // ASLI dulu (selaras "video didominasi footage Pelangi"), (2) B-roll generik kalau
    // footage asli sudah habis, (3) GAGAL dgn pesan jelas kalau tetap kurang - drpd
    // diam2 kirim video di bawah standar yg diwajibkan.
    const currentTotalDuration = () =>
      selected.reduce((sum, seg) => sum + (seg.end - seg.start), 0) +
      brollClips.reduce((sum, c) => sum + c.durationSeconds, 0);
    // Margin aman (2026-08-05, ditemukan lewat tes nyata - durasi NOMINAL klip Pexels
    // [field "duration" dari API] kadang tidak sama persis dgn durasi FILE video kualitas
    // tertentu yg sungguhan diserve, jadi total durasi hasil RENDER akhir bisa sedikit di
    // bawah estimasi pre-render walau perhitungan nominal sudah pas di angka minimum).
    // Top-up di sini kejar target LEBIH TINGGI dari minimum sungguhan supaya varian kecil
    // itu tidak bikin hasil akhir jatuh di bawah 40 detik - pengecekan akhir (setelah
    // render, lihat rendered.durationSeconds di bawah) tetap pakai angka minimum ASLI.
    const PRE_RENDER_TARGET_SECONDS = MIN_VIDEO_DURATION_SECONDS + 3;

    if (!isStockFootage && currentTotalDuration() < PRE_RENDER_TARGET_SECONDS) {
      // Tarik segmen ASLI TAMBAHAN dari pool lengkap (bukan cuma yg lolos budget/ambang
      // skor awal) - urut skor tertinggi dulu, sama logikanya dgn fallback selectClips.
      const usedKeys = new Set(selected.map((s) => `${s.sourceUrl}|${s.start}`));
      const remainingScored = scoreSegments(
        pooled.filter((s) => !usedKeys.has(`${s.sourceUrl}|${s.start}`)),
        project.script
      ).sort((a, b) => b.combinedScore - a.combinedScore);
      for (const seg of remainingScored) {
        if (currentTotalDuration() >= PRE_RENDER_TARGET_SECONDS) break;
        const cappedEnd = Math.min(seg.end, seg.start + MAX_CLIP_DURATION);
        selected.push({ ...seg, end: cappedEnd });
      }
    }

    if (currentTotalDuration() < PRE_RENDER_TARGET_SECONDS && brollKeywords) {
      // Footage asli sudah habis (atau ini jalur 100% stok) - top-up pakai B-roll
      // GENERIK tambahan (bukan destinasi spesifik - itu sengaja dibatasi 1 klip per
      // landmark, lihat destinationBroll.ts). Exclude set terus bertambah tiap iterasi
      // supaya klip TIDAK berulang dlm video yg sama (anti-monoton berlaku jg di sini).
      const usedBrollUrls = new Set([...recentlyUsedUrls, ...brollClips.map((c) => c.videoUrl)]);
      let attempts = 0;
      while (currentTotalDuration() < PRE_RENDER_TARGET_SECONDS && attempts < 8) {
        attempts += 1;
        const broll = await searchBrollVideo(brollKeywords, usedBrollUrls);
        if (!broll) break;
        usedBrollUrls.add(broll.videoUrl);
        brollClips.push({ videoUrl: broll.videoUrl, durationSeconds: Math.min(broll.durationSeconds, MAX_CLIP_DURATION) });
      }
    }

    if (currentTotalDuration() < MIN_VIDEO_DURATION_SECONDS) {
      throw new Error(
        `Footage/B-roll yg tersedia tidak cukup utk capai minimum ${MIN_VIDEO_DURATION_SECONDS} detik ` +
          `(cuma dapat ~${Math.round(currentTotalDuration())} detik) - upload lebih banyak footage asli, atau coba ide/skrip lain.`
      );
    }

    // Subtitle dibuat dari CAPTION (bukan transkrip asli lagi) - krn AI Dubbing (di
    // bawah) MENGGANTI TOTAL audio dgn TTS membaca caption, subtitle jg HARUS teks yg
    // sama, bukan transkrip asli yg sudah tidak match dgn audio barunya.
    const totalDuration = currentTotalDuration();
    const srt = buildCaptionSrt(caption, totalDuration);

    await db
      .update(projects)
      .set({
        status: "ready",
        transcript: JSON.stringify(segments),
        clipSelection: JSON.stringify(selected),
        generatedCaption: caption,
        generatedHashtags: JSON.stringify(hashtags),
        pillar,
        angle,
        targetKeyword,
        keywordLevel,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId: id,
      type: "subtitle_file",
      fileUrl: `data:text/plain;base64,${Buffer.from(srt).toString("base64")}`,
      durationSeconds: null,
      createdAt: new Date(),
    });

    const rendered = await renderFinalVideo({
      projectId: id,
      brandId: project.brandId,
      segments: selected,
      srtContent: srt,
      brollClips,
      // AI Dubbing - GANTI TOTAL suara asli (lihat memory proyek, keputusan eksplisit
      // Agus), reuse caption yg sudah di-generate sbg naskah narasi - tidak perlu
      // panggilan GPT terpisah.
      voiceoverText: caption,
      // Logo brand OPSIONAL (2026-08-05, permintaan Agus) - lihat catatan lengkap di
      // cabang carousel di atas, sama alasannya.
      logoUrl: brand?.logoUrl,
    });

    // Jaring pengaman TERAKHIR (2026-08-05) - cek durasi SUNGGUHAN hasil render (ffprobe,
    // bukan estimasi pre-render) tetap >= minimum wajib. Ditemukan lewat tes nyata: durasi
    // NOMINAL klip Pexels kadang beda dari durasi FILE sungguhan yg diserve, jadi estimasi
    // pre-render (sudah dikasih margin +3dtk, lihat PRE_RENDER_TARGET_SECONDS di atas) bisa
    // meleset. Render yg SUDAH JADI tapi ternyata di bawah standar tetap DIBUANG (bukan
    // dipublikasikan diam2 melanggar aturan "tidak boleh kurang dari 40 detik") - biaya
    // render yg terbuang lebih baik drpd konten yg melanggar aturan keras yg diminta Agus.
    if (rendered.durationSeconds < MIN_VIDEO_DURATION_SECONDS) {
      throw new Error(
        `Video hasil render cuma ${rendered.durationSeconds} detik, di bawah minimum ` +
          `${MIN_VIDEO_DURATION_SECONDS} detik yg diwajibkan (estimasi pre-render meleset - ` +
          `durasi nyata sumber footage beda dari metadata) - coba generate ulang.`
      );
    }

    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId: id,
      type: "final_video",
      fileUrl: rendered.videoUrl,
      durationSeconds: rendered.durationSeconds,
      createdAt: new Date(),
    });

    // Catat klip Pexels/Pixabay yg baru dipakai (anti-monoton, lihat
    // getRecentlyUsedFootageUrls di atas) - dibaca project VIDEO berikutnya brand ini
    // supaya klip yg sama tidak kepilih lagi persis.
    for (const c of brollClips) {
      await db.insert(mediaAssets).values({
        id: newId("asset"),
        projectId: id,
        type: "broll_used",
        fileUrl: c.videoUrl,
        durationSeconds: c.durationSeconds,
        createdAt: new Date(),
      });
    }

    if (thumbnailText) {
      const [ytAccount] = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.platform, "youtube")));
      if (ytAccount) {
        const thumbnailUrl = await generateThumbnail({
          brandId: project.brandId,
          projectId: id,
          rawFootageUrl: rawFootage.fileUrl,
          thumbnailText,
        });
        await db.insert(mediaAssets).values({
          id: newId("asset"),
          projectId: id,
          type: "thumbnail",
          fileUrl: thumbnailUrl,
          durationSeconds: null,
          createdAt: new Date(),
        });
      }
    }

    return { caption, hashtags, clipCount: selected.length, structureTemplate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(projects.id, id));
    throw err;
  }
}
