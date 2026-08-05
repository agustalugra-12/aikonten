import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets, brands, footageBank } from "@/db/schema";
import { newId } from "@/lib/ids";
import { suggestContentIdeas } from "@/lib/ai/researchTopics";
import { matchFootageForScript, pickAnyRealPhoto } from "@/lib/ai/matchFootageBank";
import { processProject } from "@/lib/pipeline/processProject";
import { isIdeSpesifikProperti } from "@/lib/ai/classifyIdea";
import { deriveBrollKeywordsFromScript } from "@/lib/ai/deriveBrollKeywords";
import { searchBrollVideo } from "@/lib/assets/broll";
import { getRecentlyUsedFootageUrls, isRoomFootage } from "@/lib/ai/footageVariety";
import { eq, desc } from "drizzle-orm";

// "⚡ Konten Otomatis" (lihat memory proyek: "otomatis seperti AI blog") - satu klik,
// TANPA upload apa pun: (1) ambil skrip dari body, atau kalau kosong usul sendiri lewat
// Research Engine, (2) cocokkan ke Footage Bank yg SUDAH ada, (3) buat project + kaitkan
// footage yg cocok (BUKAN upload baru - fileUrl bank dipakai langsung), (4) proses spt
// biasa (processProject, sama persis dipakai /process manual) - berhenti di status
// "ready" (draft), TIDAK auto-publish (lihat DraftReview.tsx).
// Batas jumlah klip/foto yg dipakai dari hasil matchFootageForScript (2026-08-05,
// permintaan Agus - "tambahkan sampai 15 klip" biar video bisa capai target 30-60
// detik lewat gabungan banyak klip pendek, lihat processProject.ts). Foto TETAP
// dibatasi lebih ketat (sama dgn NewProjectDialog.tsx MAX_CAROUSEL_PHOTOS) - carousel
// terlalu banyak foto tidak masuk akal utk 1 post, beda dgn video yg memang perlu
// banyak klip pendek utk isi durasi.
const MAX_VIDEO_CLIPS_AUTO = 15;
const MAX_CAROUSEL_PHOTOS_AUTO = 5;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await req.json().catch(() => ({}));
  let script: string | undefined = body.script;

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  try {
    if (!script) {
      const recentProjects = await db
        .select({ script: projects.script })
        .from(projects)
        .where(eq(projects.brandId, brandId))
        .orderBy(desc(projects.createdAt))
        .limit(15);
      const recentScripts = recentProjects.map((p) => p.script).filter((s): s is string => !!s);
      const ideas = await suggestContentIdeas(brand.name, brand.description, recentScripts);
      if (ideas.length === 0) {
        return NextResponse.json({ error: "AI tidak berhasil kasih ide konten" }, { status: 500 });
      }
      script = ideas[0];
    }

    const matchedUrls = await matchFootageForScript(brandId, script);
    let type: "video" | "carousel" = "carousel";
    let urlsToUse: string[] = [];
    let fromBroll = false;
    // Durasi video stok (Pexels/Pixabay) - HANYA terisi kalau urlsToUse[0] hasil fallback
    // broll di bawah, dipakai processProject.ts membangun 1 segmen sintetis (video stok
    // tidak ditranskrip, lihat catatan lengkap di sana).
    let brollAssetDurationSeconds: number | null = null;

    if (matchedUrls.length > 0) {
      // Tentukan tipe project dari jenis footage yg cocok pertama - foto bisa lebih dari
      // 1 (carousel, sudah didukung, dibatasi MAX_CAROUSEL_PHOTOS_AUTO). Video JUGA bisa
      // lebih dari 1 klip sekaligus (2026-08-05, permintaan Agus - "video didominasi
      // footage Pelangi", rasio 7:3, target 30-60 detik - 1 klip sendirian sering
      // terlalu pendek, lihat processProject.ts pooling multi-source &
      // REAL_FOOTAGE_BUDGET_SECONDS) - pakai klip video yg cocok sampai
      // MAX_VIDEO_CLIPS_AUTO (matchFootageForScript sendiri sekarang boleh balikin
      // sampai 15 kandidat, lihat matchFootageBank.ts). matchFootageForScript cuma
      // balikin fileUrl, jadi query bank lagi utk tau mediaType tiap item yg cocok.
      const matchedRows = await db.select().from(footageBank).where(eq(footageBank.brandId, brandId));
      const matchedItems = matchedRows.filter((r) => matchedUrls.includes(r.fileUrl));
      const isVideo = matchedItems[0]?.mediaType === "video";
      type = isVideo ? "video" : "carousel";
      if (isVideo) {
        // Anti-monoton (2026-08-05, permintaan Agus - "footage jangan monoton",
        // "ini penting sekali") - utamakan klip yg BELUM dipakai di 5 video terakhir
        // brand ini (lihat footageVariety.ts). Kalau footage segar kurang dari 3 klip
        // (bank terbatas), tetap backfill pakai yg pernah dipakai drpd gagal total -
        // variasi lebih baik drpd tidak ada, tapi jangan sampai video gagal digenerate.
        const videoCandidates = matchedItems.filter((r) => r.mediaType === "video");
        const recentlyUsed = await getRecentlyUsedFootageUrls(brandId);
        const fresh = videoCandidates.filter((r) => !recentlyUsed.has(r.fileUrl));
        const pool = fresh.length >= 3 ? fresh : videoCandidates;
        urlsToUse = pool.map((r) => r.fileUrl).slice(0, MAX_VIDEO_CLIPS_AUTO);

        // Pastikan ada footage "kamar" Pelangi ditampilkan (2026-08-05, permintaan
        // Agus - "di setiap pembuatan video ada menampilkan room Pelangi dari
        // footage") - kalau belum ada satu pun klip room di hasil pilihan, cari di
        // SELURUH bank (bukan cuma yg matchFootageForScript anggap relevan tema-nya -
        // room selalu relevan ditampilkan, terlepas topik skrip), prioritaskan yg
        // belum baru dipakai, tempel di akhir (gantikan slot terakhir kalau sudah
        // penuh MAX_VIDEO_CLIPS_AUTO drpd melebihi batas).
        if (!pool.some((r) => isRoomFootage(r.description, r.tags))) {
          const allVideos = matchedRows.filter((r) => r.mediaType === "video");
          const roomCandidates = allVideos.filter(
            (r) => isRoomFootage(r.description, r.tags) && !urlsToUse.includes(r.fileUrl)
          );
          const freshRoom = roomCandidates.filter((r) => !recentlyUsed.has(r.fileUrl));
          const roomPick = freshRoom[0] || roomCandidates[0];
          if (roomPick) {
            if (urlsToUse.length >= MAX_VIDEO_CLIPS_AUTO) {
              urlsToUse[urlsToUse.length - 1] = roomPick.fileUrl;
            } else {
              urlsToUse.push(roomPick.fileUrl);
            }
          }
        }
      } else {
        urlsToUse = matchedUrls.slice(0, MAX_CAROUSEL_PHOTOS_AUTO);
      }
    } else {
      // Fallback (2026-08-04, permintaan Agus - "kalau footage tidak ada, tetap harus
      // bisa digenerate") - dua jalur TERPISAH, TIDAK BOLEH tertukar:
      //
      // (1) VIDEO, HANYA utk ide UMUM (bukan soal harga/fasilitas/kamar spesifik
      //     properti - lihat classifyIdea.ts): boleh pakai video stok Pexels/Pixabay
      //     sbg footage dasar. Video B-roll TIDAK PUNYA ucapan asli yg relevan utk
      //     ditranskrip - processProject.ts mendeteksi sumber ini via URL & SKIP
      //     transcribe+selectClips, langsung pakai klip utuh + AI Dubbing baca caption
      //     sbg narasi (pola yg SAMA persis dgn dubbing yg sudah ada, cuma sumber
      //     videonya beda).
      //
      // (2) FOTO, utk SEMUA ide (umum MAUPUN spesifik) - Agus TEGAS: foto WAJIB SELALU
      //     asli Pelangi/Harmoni, TIDAK BOLEH Pexels sama sekali (beda dari video) -
      //     supaya klaim harga/fasilitas tidak pernah "ditempel" di foto kamar orang
      //     lain. Kalau tidak ada foto yg cocok TEMA persis, tetap pakai foto asli
      //     APA SAJA yg ada di bank (pickAnyRealPhoto) - overlay teks promo
      //     (applyPromoOverlay, sudah ada) yg menyampaikan pesan spesifiknya, bukan
      //     foto itu sendiri yg perlu cocok tema.
      const spesifik = isIdeSpesifikProperti(script);

      if (!spesifik) {
        try {
          const keywords = await deriveBrollKeywordsFromScript(script);
          const broll = await searchBrollVideo(keywords);
          if (broll) {
            type = "video";
            urlsToUse = [broll.videoUrl];
            fromBroll = true;
            brollAssetDurationSeconds = broll.durationSeconds;
          }
        } catch (err) {
          console.error("[auto-content] fallback Pexels/Pixabay gagal:", err);
        }
      }

      if (urlsToUse.length === 0) {
        const anyPhoto = await pickAnyRealPhoto(brandId);
        if (anyPhoto) {
          type = "carousel";
          urlsToUse = [anyPhoto];
        }
      }

      if (urlsToUse.length === 0) {
        return NextResponse.json(
          {
            error: spesifik
              ? "Ide ini spesifik soal properti (harga/fasilitas/kamar) - wajib footage/foto asli, tidak ada yg cocok di Bank Footage. Upload dulu footage asli, atau foto apa pun (utk fallback foto)."
              : "Tidak ada footage di bank yg cocok, video stok cadangan juga tidak ketemu, dan belum ada foto asli sama sekali di Bank Footage.",
          },
          { status: 400 }
        );
      }
    }

    const now = new Date();
    const projectId = newId("proj");

    await db.insert(projects).values({
      id: projectId,
      brandId,
      type,
      status: "uploaded",
      script,
      transcript: null,
      clipSelection: null,
      generatedCaption: null,
      generatedHashtags: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    for (const url of urlsToUse) {
      await db.insert(mediaAssets).values({
        id: newId("asset"),
        projectId,
        type: "raw_footage",
        fileUrl: url,
        // fromBroll: simpan durasi asli video stok - processProject.ts butuh ini utk
        // membangun segmen sintetis (video stok TIDAK ditranskrip, lihat catatan di sana).
        durationSeconds: fromBroll && url === urlsToUse[0] ? brollAssetDurationSeconds : null,
        createdAt: new Date(),
      });
    }

    const result = await processProject(projectId);
    return NextResponse.json({ ok: true, projectId, script, fromBroll, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
