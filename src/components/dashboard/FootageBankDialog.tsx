"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type BankItem = {
  id: string;
  mediaType: "video" | "image";
  fileUrl: string;
  description: string;
  tags: string[];
};

// "Footage Bank" (lihat memory proyek) - Agus upload footage SEKALI di sini (bukan per
// project), AI otomatis kasih deskripsi+tag (tidak perlu ketik apa2), lalu footage ini
// bisa dipakai berkali-kali oleh "⚡ Konten Otomatis" (lihat AutoContentButton.tsx)
// tanpa perlu upload ulang tiap bikin konten baru.
export function FootageBankDialog({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  async function loadItems() {
    const res = await fetch(`/api/brands/${brandId}/footage-bank`);
    if (res.ok) setItems(await res.json());
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && items === null) await loadItems();
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const presignRes = await fetch(`/api/brands/${brandId}/footage-bank/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        });
        if (!presignRes.ok) throw new Error((await presignRes.json()).error || "Gagal menyiapkan upload");
        const { uploadUrl, publicUrl } = await presignRes.json();

        const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!putRes.ok) throw new Error(`Gagal upload ${file.name}`);

        const mediaType = file.type.startsWith("video/") ? "video" : "image";
        const regRes = await fetch(`/api/brands/${brandId}/footage-bank`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl: publicUrl, mediaType }),
        });
        if (!regRes.ok) throw new Error((await regRes.json()).error || `Gagal mendaftarkan ${file.name}`);
        toast.success(`${file.name} ditambahkan ke bank`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Gagal upload ${file.name}`);
      }
    }

    setUploading(null);
    await loadItems();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">📦 Bank Footage</Button>} />
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bank Footage</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Input
              type="file"
              accept="video/*,image/*"
              multiple
              onChange={(e) => handleUpload(e.target.files)}
              disabled={!!uploading}
            />
            {uploading && <p className="text-xs text-muted-foreground">Mengunggah &amp; menganalisis {uploading}...</p>}
          </div>

          <Separator />

          {items === null ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada footage di bank. Upload video/foto yang bisa dipakai ulang utk banyak konten (kamar,
              pemandangan, fasilitas, dst).
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.mediaType === "video" ? "Video" : "Foto"}</Badge>
                  </div>
                  <p className="text-sm">{item.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
