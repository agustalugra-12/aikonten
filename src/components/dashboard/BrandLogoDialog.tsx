"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Logo brand (2026-08-05, permintaan Agus) - upload SEKALI per brand, dipakai
// processProject.ts (poster/carousel via logoOverlay.ts, video via ffmpeg.ts) utk
// nempel watermark lingkaran proporsional di SETIAP foto & video final berikutnya -
// bukan per-konten, jadi cukup 1 dialog kecil di sini, bukan bagian dari NewProjectDialog.
export function BrandLogoDialog({
  brandId,
  logoUrl,
  onChanged,
}: {
  brandId: string;
  logoUrl: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function saveLogoUrl(url: string | null) {
    const res = await fetch(`/api/brands/${brandId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoUrl: url }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Gagal menyimpan logo");
  }

  async function handleUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const presignRes = await fetch(`/api/brands/${brandId}/logo-upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error((await presignRes.json()).error || "Gagal menyiapkan upload");
      const { uploadUrl, publicUrl } = await presignRes.json();

      const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error("Gagal upload logo");

      await saveLogoUrl(publicUrl);
      toast.success("Logo brand tersimpan");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal upload logo");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    try {
      await saveLogoUrl(null);
      toast.success("Logo brand dihapus");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus logo");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">🖼️ Logo Brand</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Logo Brand</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Logo ini otomatis ditempel (lingkaran, ukuran proporsional, pojok kanan-atas) di setiap foto &amp; video
            hasil AI berikutnya. Kosongkan kalau tidak mau pakai watermark logo.
          </p>

          {logoUrl && (
            <div className="flex items-center gap-3">
              <img
                src={logoUrl}
                alt="Logo saat ini"
                className="w-16 h-16 rounded-full object-cover border"
              />
              <Button variant="ghost" size="sm" onClick={handleRemove}>
                Hapus logo
              </Button>
            </div>
          )}

          <Input type="file" accept="image/*" onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
          {uploading && <p className="text-xs text-muted-foreground">Mengunggah logo...</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
