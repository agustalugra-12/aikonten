import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets, brands, footageBank } from "@/db/schema";
import { newId } from "@/lib/ids";
import { suggestContentIdeas } from "@/lib/ai/researchTopics";
import { matchFootageForScript } from "@/lib/ai/matchFootageBank";
import { processProject } from "@/lib/pipeline/processProject";
import { eq, desc } from "drizzle-orm";

// "⚡ Konten Otomatis" (lihat memory proyek: "otomatis seperti AI blog") - satu klik,
// TANPA upload apa pun: (1) ambil skrip dari body, atau kalau kosong usul sendiri lewat
// Research Engine, (2) cocokkan ke Footage Bank yg SUDAH ada, (3) buat project + kaitkan
// footage yg cocok (BUKAN upload baru - fileUrl bank dipakai langsung), (4) proses+
// publish spt biasa (processProject, sama persis dipakai /process manual).
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
    if (matchedUrls.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada footage di bank yg cocok dgn skrip ini - upload dulu ke Bank Footage" },
        { status: 400 }
      );
    }

    // Tentukan tipe project dari jenis footage yg cocok pertama - video pakai 1 klip
    // (sama spt jalur upload manual, lihat processProject.ts), foto bisa lebih dari 1
    // (carousel, sudah didukung). matchFootageForScript cuma balikin fileUrl, jadi
    // query bank lagi utk tau mediaType tiap item yg cocok.
    const now = new Date();
    const projectId = newId("proj");

    const matchedRows = await db.select().from(footageBank).where(eq(footageBank.brandId, brandId));
    const matchedItems = matchedRows.filter((r) => matchedUrls.includes(r.fileUrl));
    const isVideo = matchedItems[0]?.mediaType === "video";
    const type = isVideo ? "video" : "carousel";
    const urlsToUse = isVideo ? [matchedUrls[0]] : matchedUrls;

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
        durationSeconds: null,
        createdAt: new Date(),
      });
    }

    const result = await processProject(projectId);
    return NextResponse.json({ ok: true, projectId, script, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
