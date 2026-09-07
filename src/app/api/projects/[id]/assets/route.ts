import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mediaAssets, projects } from "@/db/schema";
import { newId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getUserId, getOwnedProject } from "@/lib/session";

// Dipanggil client SETELAH selesai PUT langsung ke storage via presigned URL (lihat
// /upload-url) - endpoint ini cuma mencatat record-nya di DB, bukan menerima file.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const { type, fileUrl, durationSeconds } = await req.json();

  const validTypes = ["raw_footage", "final_video", "final_image", "subtitle_file"];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `type harus salah satu dari: ${validTypes.join(", ")}` }, { status: 400 });
  }
  if (typeof fileUrl !== "string" || !fileUrl) {
    return NextResponse.json({ error: "fileUrl wajib diisi" }, { status: 400 });
  }

  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  const row = {
    id: newId("asset"),
    projectId: id,
    type,
    fileUrl,
    durationSeconds: durationSeconds ?? null,
    createdAt: new Date(),
  };
  await db.insert(mediaAssets).values(row);

  if (type === "raw_footage") {
    await db
      .update(projects)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(projects.id, id));
  }

  return NextResponse.json(row, { status: 201 });
}
