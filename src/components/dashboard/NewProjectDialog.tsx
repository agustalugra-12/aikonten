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
const MAX_CAROUSEL_PHOTOS = 5;

export function NewProjectDialog({
  brandId,
  onCreated,
  initialScript,
}: {
  brandId: string;
  onCreated: () => void;
  // Diisi kalau dialog ini dibuka dari "Ide Konten" (ContentIdeas.tsx) - lihat
  // page.tsx, komponen ini di-remount pakai `key` tiap initialScript berubah biar
  // useState di bawah selalu mulai dari nilai baru.
  initialScript?: string;
}) {
  const [open, setOpen] = useState(!!initialScript);
  const [type, setType] = useState<"video" | "carousel">("video");
  const [script, setScript] = useState(initialScript || "");
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<string | null>(null);

  const hasFiles = type === "carousel" ? files.length > 0 : !!file;

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

      if (type === "carousel") {
        for (let i = 0; i < files.length; i++) {
          setStage(`Mengunggah foto ${i + 1}/${files.length}...`);
          await uploadOneFile(project.id, files[i]);
        }
      } else {
        setStage("Mengunggah footage...");
        await uploadOneFile(project.id, file!);
      }

      setStage("Memproses dengan AI (transkripsi, pilih klip, caption)...");
      const processRes = await fetch(`/api/projects/${project.id}/process`, { method: "POST" });
      if (!processRes.ok) {
        const data = await processRes.json().catch(() => ({}));
        throw new Error(data.error || "Gagal memproses AI");
      }

      toast.success("Project selesai diproses, siap dipublikasikan");
      setScript("");
      setFile(null);
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
            <Select value={type} onValueChange={(v) => setType(v as "video" | "carousel")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="carousel">Carousel</SelectItem>
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
            <Label htmlFor="footage">{type === "carousel" ? `Foto (maks ${MAX_CAROUSEL_PHOTOS})` : "Footage mentah"}</Label>
            {type === "carousel" ? (
              <Input
                id="footage"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_CAROUSEL_PHOTOS))}
              />
            ) : (
              <Input
                id="footage"
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            )}
            {type === "carousel" && files.length > 0 && (
              <p className="text-xs text-muted-foreground">{files.length} foto dipilih</p>
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
