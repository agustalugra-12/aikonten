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
// (5) trigger /process (transkripsi+pemilihan klip+caption/hashtag, full-auto sesuai
// keputusan Agus - tidak ada jeda approval manual di sini).
export function NewProjectDialog({ brandId, onCreated }: { brandId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"video" | "carousel">("video");
  const [script, setScript] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!file || !script.trim()) return;

    try {
      setStage("Membuat project...");
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, type, script }),
      });
      if (!projRes.ok) throw new Error((await projRes.json()).error || "Gagal membuat project");
      const project = await projRes.json();

      setStage("Mengunggah footage...");
      const presignRes = await fetch(`/api/projects/${project.id}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error((await presignRes.json()).error || "Gagal menyiapkan upload");
      const { uploadUrl, publicUrl } = await presignRes.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Gagal upload file ke storage");

      setStage("Mencatat asset...");
      const assetRes = await fetch(`/api/projects/${project.id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "raw_footage", fileUrl: publicUrl }),
      });
      if (!assetRes.ok) throw new Error((await assetRes.json()).error || "Gagal mencatat asset");

      setStage("Memproses dengan AI (transkripsi, pilih klip, caption)...");
      const processRes = await fetch(`/api/projects/${project.id}/process`, { method: "POST" });
      if (!processRes.ok) {
        const data = await processRes.json().catch(() => ({}));
        throw new Error(data.error || "Gagal memproses AI");
      }

      toast.success("Project selesai diproses, siap dipublikasikan");
      setScript("");
      setFile(null);
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
            <Label htmlFor="footage">Footage mentah</Label>
            <Input
              id="footage"
              type="file"
              accept="video/*,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!!stage || !file || !script.trim()}>
            {stage || "Buat & Proses Otomatis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
