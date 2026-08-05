"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Alur upload: (1) buat project -> (2) minta presigned URL -> (3) PUT file LANGSUNG ke
// storage (bukan lewat server kita, lihat lib/storage.ts) -> (4) catat asset di DB ->
// (5) trigger /process (transkripsi+pemilihan klip+caption/hashtag). Berhenti di status
// "ready" (draft) - publish TIDAK lagi otomatis, Agus review dulu di DraftReview.tsx
// (2026-08-04) sebelum klik publikasikan.
// Video BOLEH >1 klip sekaligus (2026-08-05, permintaan Agus - "video didominasi
// footage Pelangi", rasio 7:3 - 1 klip sendirian sering terlalu pendek/panjang utk isi
// 70% target durasi, lihat clipSelect.ts & pooling multi-source di renderFinalVideo).
// Dulu cuma 1 file video per project. Dinaikkan ke 15 (2026-08-05, permintaan eksplisit
// Agus) - klip asli Agus sering pendek (2-6 detik), perlu cukup banyak digabung utk
// benar-benar capai target durasi. Dinaikkan lagi ke 20 (2026-08-05, sesi sama) - opsi
// durasi target sampai 90 detik/1.30 butuh ~17 klip di rata2 durasi klip asli ~3.7dtk,
// 15 tidak cukup lagi.
const MAX_VIDEO_CLIPS = 20;
// Foto tunggal WAJIB 1 file - beda dari carousel. Batas ini SENGAJA dipisah dari jumlah
// carousel (2026-08-05, permintaan Agus - "kenapa tidak ada pilihan foto tunggal?")
// walau di DB kedua mode SAMA-SAMA type="carousel" (processProject.ts sudah lama
// membedakan poster foto tunggal vs carousel murni dari JUMLAH foto yg diupload, bukan
// field terpisah - lihat processProject.ts finalImageUrls) - "mode" di sini CUMA soal
// kejelasan UI, bukan skema data baru.
const SINGLE_PHOTO_MAX = 1;

// "mode" (3 pilihan UI) vs "type" (2 nilai backend "video"|"carousel") SENGAJA
// dipisah - foto tunggal & carousel SAMA-SAMA type="carousel" di project (perbedaan
// poster-tunggal vs carousel-badge sudah ditentukan processProject.ts dari JUMLAH
// foto), jadi tidak perlu migrasi skema, cukup UI yg lebih jelas.
type ContentMode = "video" | "photo" | "carousel";

function modeToType(mode: ContentMode): "video" | "carousel" {
  return mode === "video" ? "video" : "carousel";
}

export function NewProjectDialog({
  brandId,
  onCreated,
  initialScript,
  initialType,
  carouselPhotosPerPost = 5,
}: {
  brandId: string;
  onCreated: () => void;
  // Diisi kalau dialog ini dibuka dari "Ide Konten"/Content Planner (ContentIdeas.tsx/
  // DailyContentPlanner.tsx) - lihat page.tsx, komponen ini di-remount pakai `key`
  // tiap initialScript berubah biar useState di bawah selalu mulai dari nilai baru.
  initialScript?: string;
  // Diisi dari Content Planner harian (2026-08-05, permintaan Agus) - tipe yg AI
  // sarankan utk ide ini, Agus tetap BOLEH ganti manual di dropdown. SEKARANG 3 tipe
  // eksplisit (video/foto/carousel, revisi Agus hari sama - sebelumnya cuma 2 tipe,
  // "carousel" dari planner DIPETAKAN ke mode "photo" scr default krn planner belum
  // bisa bedakan foto tunggal vs carousel beneran). "Ide Konten" lama (ContentIdeas.tsx)
  // tidak isi ini, default tetap "video".
  initialType?: "video" | "foto" | "carousel";
  // Target jumlah foto per post carousel (2026-08-05, permintaan Agus - "carousel 3
  // foto, 5 foto, 7 foto") - setting per-brand (brands.carouselPhotosPerPost), dipakai
  // sbg MIN & MAX carousel sekaligus (target PERSIS, bukan sekadar batas atas).
  carouselPhotosPerPost?: number;
}) {
  const [open, setOpen] = useState(!!initialScript);
  const [mode, setMode] = useState<ContentMode>(
    initialType === "carousel" ? "carousel" : initialType === "foto" ? "photo" : "video"
  );
  const [script, setScript] = useState(initialScript || "");
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<string | null>(null);

  const type = modeToType(mode);
  const maxFiles = mode === "photo" ? SINGLE_PHOTO_MAX : mode === "carousel" ? carouselPhotosPerPost : MAX_VIDEO_CLIPS;
  // Carousel: min & max SAMA (target PERSIS sesuai setting brand), BUKAN sekadar
  // rentang longgar - sesuai permintaan Agus "carousel 3 foto/5 foto/7 foto" (preset
  // ukuran tetap, bukan batas atas fleksibel).
  const minFiles = mode === "carousel" ? carouselPhotosPerPost : 1;
  const hasFiles = files.length >= minFiles;

  async function uploadOneFile(projectId: string, f: File): Promise<string> {
    const presignRes = await fetch(`/api/projects/${projectId}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: f.name, contentType: f.type }),
    });
    if (!presignRes.ok) throw new Error((await presignRes.json()).error || "Gagal menyiapkan upload");
    const { uploadUrl, publicUrl } = await presignRes.json();

    const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
    if (!putRes.ok) throw new Error(`Gagal upload ${f.name} ke storage`);

    const assetRes = await fetch(`/api/projects/${projectId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "raw_footage", fileUrl: publicUrl }),
    });
    if (!assetRes.ok) throw new Error((await assetRes.json()).error || `Gagal mencatat asset ${f.name}`);
    return publicUrl;
  }

  async function handleSubmit() {
    if (!hasFiles || !script.trim()) return;

    try {
      setStage("Membuat project...");
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, type, script }),
      });
      if (!projRes.ok) throw new Error((await projRes.json()).error || "Gagal membuat project");
      const project = await projRes.json();

      for (let i = 0; i < files.length; i++) {
        setStage(`Mengunggah ${type === "carousel" ? "foto" : "footage"} ${i + 1}/${files.length}...`);
        await uploadOneFile(project.id, files[i]);
      }

      setStage("Memproses dengan AI (transkripsi, pilih klip, caption)...");
      const processRes = await fetch(`/api/projects/${project.id}/process`, { method: "POST" });
      if (!processRes.ok) {
        const data = await processRes.json().catch(() => ({}));
        throw new Error(data.error || "Gagal memproses AI");
      }

      toast.success("Project selesai diproses, siap dipublikasikan");
      setScript("");
      setFiles([]);
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setStage(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ Konten Baru</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Konten Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipe konten</Label>
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v as ContentMode);
                setFiles([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="photo">Foto Tunggal</SelectItem>
                <SelectItem value="carousel">Carousel (multi-foto)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="script">Skrip / brief</Label>
            <textarea
              id="script"
              className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Jelaskan pesan/topik yang ingin disampaikan - dipakai AI utk memilih klip terbaik & menulis caption"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="footage">
              {mode === "photo"
                ? "Foto (1 foto - jadi poster)"
                : mode === "carousel"
                  ? `Foto (tepat ${maxFiles} foto)`
                  : `Footage mentah (boleh >1 klip, maks ${maxFiles})`}
            </Label>
            <Input
              id="footage"
              type="file"
              accept={mode === "video" ? "video/*" : "image/*"}
              multiple={mode !== "photo"}
              onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, maxFiles))}
            />
            {files.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {files.length} {mode === "video" ? "klip" : "foto"} dipilih
                {mode === "carousel" && files.length < minFiles && ` - butuh tepat ${minFiles} foto utk carousel`}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!!stage || !hasFiles || !script.trim()}>
            {stage || "Buat & Proses Otomatis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
