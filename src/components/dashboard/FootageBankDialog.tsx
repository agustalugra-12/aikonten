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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type BankItem = {
  id: string;
  mediaType: "video" | "image";
  fileUrl: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  posterUrl: string | null;
};

type Category = {
  id: string;
  name: string;
};

const UNCATEGORIZED = "__uncategorized__";

// Lewatkan pratinjau lewat domain aplikasi sendiri, bukan hotlink langsung ke r2.dev
// (2026-08-06, laporan Agus - "bank footage tidak bisa memutar vidio, dan foto tidak
// terlihat selalu gagal reload" - root cause SAMA yg sudah pernah ditemukan & diperbaiki
// utk pratinjau draft di DraftReview.tsx 2026-08-05, lihat catatan lengkap di
// api/media-proxy/route.ts: domain pub-*.r2.dev kemungkinan besar kena blokir jaringan di
// sisi Agus - file-nya sendiri terbukti sehat (dicek server-side & dari jaringan lain di
// luar Indonesia). Komponen ini LUPA dipasangi proxy yg sama waktu itu - cuma DraftReview
// yg diperbaiki, Bank Footage (ditambahkan hari yg sama) ketinggalan.
function previewUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

// "Footage Bank" (lihat memory proyek) - Agus upload footage SEKALI di sini (bukan per
// project), AI otomatis kasih deskripsi+tag (tidak perlu ketik apa2), lalu footage ini
// bisa dipakai berkali-kali oleh "⚡ Konten Otomatis" (lihat AutoContentButton.tsx)
// tanpa perlu upload ulang tiap bikin konten baru.
//
// Kategori manual (2026-08-06, permintaan Agus - "taman halaman, kamar, dapur, dan
// lainnya... jadi lebih enak ketika ada perintah day use room standart maka foto yang
// di pilih memang dari vidio dan foto dsana bukan room cotage") - lihat matchFootageBank.ts
// utk gimana kategori ini dipakai jadi sinyal keras saat AI pilih footage per skrip.
export function FootageBankDialog({ brandId }: { brandId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [uploadCategoryId, setUploadCategoryId] = useState<string>(UNCATEGORIZED);
  // Fallback pemuatan gagal (2026-08-06, laporan Agus - "tidak terlihat ada gambar foto
  // rusak di pojok kiri") - ikon "gambar rusak" bawaan browser SELALU muncul di pojok
  // KIRI-ATAS elemen <img> kalau src gagal dimuat (perilaku browser standar, bukan
  // sesuatu yg kita render sendiri) - baru KELIHATAN sekarang krn thumbnail asli baru
  // ditambahkan hari ini (sebelumnya cuma teks, tidak ada <img> sama sekali). File
  // aslinya sudah dicek server-side (fetch+decode penuh) - SEMUA 44 foto Pelangi valid,
  // jadi kegagalan ini kemungkinan besar sesaat/jaringan browser, bukan file rusak
  // sungguhan. Retry OTOMATIS 1x (cache-bust query param) sebelum nyerah ke fallback
  // UI yg jelas (bukan ikon default browser yg terlihat spt "error aplikasi").
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [retriedIds, setRetriedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadItems() {
    const [itemsRes, categoriesRes] = await Promise.all([
      fetch(`/api/brands/${brandId}/footage-bank`),
      fetch(`/api/brands/${brandId}/footage-categories`),
    ]);
    if (itemsRes.ok) setItems(await itemsRes.json());
    if (categoriesRes.ok) setCategories(await categoriesRes.json());
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && items === null) await loadItems();
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const res = await fetch(`/api/brands/${brandId}/footage-categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error((await res.json()).error || "Gagal menambah kategori");
      return;
    }
    setNewCategoryName("");
    await loadItems();
    toast.success(`Kategori "${name}" ditambahkan`);
  }

  async function handleDeleteCategory(categoryId: string) {
    const res = await fetch(`/api/brands/${brandId}/footage-categories/${categoryId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Gagal menghapus kategori");
      return;
    }
    if (filterCategory === categoryId) setFilterCategory("all");
    await loadItems();
  }

  async function handleAssignCategory(itemId: string, categoryId: string) {
    const res = await fetch(`/api/brands/${brandId}/footage-bank/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: categoryId === UNCATEGORIZED ? null : categoryId }),
    });
    if (!res.ok) {
      toast.error("Gagal menyimpan kategori");
      return;
    }
    setItems((prev) =>
      prev
        ? prev.map((it) => (it.id === itemId ? { ...it, categoryId: categoryId === UNCATEGORIZED ? null : categoryId } : it))
        : prev
    );
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm("Hapus footage ini dari bank? Tindakan ini tidak bisa dibatalkan.")) return;
    setDeletingId(itemId);
    try {
      const res = await fetch(`/api/brands/${brandId}/footage-bank/${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Gagal menghapus footage");
      setItems((prev) => (prev ? prev.filter((it) => it.id !== itemId) : prev));
      toast.success("Footage dihapus");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus footage");
    } finally {
      setDeletingId(null);
    }
  }

  function handleImageError(itemId: string) {
    setRetriedIds((prev) => {
      if (prev.has(itemId)) {
        // Sudah pernah di-retry sekali & tetap gagal - benar2 nyerah, tampilkan fallback.
        setFailedIds((f) => new Set(f).add(itemId));
        return prev;
      }
      return new Set(prev).add(itemId);
    });
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
          body: JSON.stringify({
            fileUrl: publicUrl,
            mediaType,
            categoryId: uploadCategoryId === UNCATEGORIZED ? null : uploadCategoryId,
          }),
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

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const visibleItems =
    items === null
      ? null
      : filterCategory === "all"
        ? items
        : filterCategory === UNCATEGORIZED
          ? items.filter((it) => !it.categoryId)
          : items.filter((it) => it.categoryId === filterCategory);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">📦 Bank Footage</Button>} />
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bank Footage</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Kategori</p>
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <Badge key={cat.id} variant="secondary" className="text-xs gap-1">
                  {cat.name}
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(cat.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Hapus kategori ${cat.name}`}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {categories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Belum ada kategori. Contoh: Kamar Standard, Cottage, Taman/Halaman, Dapur.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Nama kategori baru..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                className="h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={handleAddCategory}>
                + Tambah
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="video/*,image/*"
                multiple
                onChange={(e) => handleUpload(e.target.files)}
                disabled={!!uploading}
                className="flex-1"
              />
              <Select value={uploadCategoryId} onValueChange={(v) => setUploadCategoryId(v || UNCATEGORIZED)}>
                <SelectTrigger className="w-40 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCATEGORIZED}>Tanpa kategori</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {uploading && <p className="text-xs text-muted-foreground">Mengunggah &amp; menganalisis {uploading}...</p>}
          </div>

          <Separator />

          {items !== null && items.length > 0 && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground shrink-0">Filter:</p>
              <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v || "all")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua footage</SelectItem>
                  <SelectItem value={UNCATEGORIZED}>Belum dikategorikan</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {visibleItems === null ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : visibleItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {items && items.length > 0
                ? "Tidak ada footage di kategori ini."
                : "Belum ada footage di bank. Upload video/foto yang bisa dipakai ulang utk banyak konten (kamar, pemandangan, fasilitas, dst)."}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {visibleItems.map((item) => (
                <div key={item.id} className="rounded-md border overflow-hidden space-y-2 pb-2">
                  {/* Thumbnail asli (2026-08-06, permintaan Agus - "tampilkan fotonya agar
                      bisa dikategorikan") - sebelumnya cuma deskripsi teks AI, susah
                      dikategorikan tanpa lihat isi foto/video aslinya.
                      Video FIX (2026-08-06, laporan Agus - "vidio berputar terus") - dulu
                      preload="metadata" TANPA poster & footage asli sering 40-90MB, render
                      SEMUA video sekaligus bikin browser antre fetch banyak file besar
                      bersamaan (terlihat spinner tanpa henti). Sekarang pakai poster JPG
                      statis (posterUrl, sudah dihitung sekali saat upload via
                      extractVideoFrame - reuse, bukan generate baru) - tampil instan, file
                      video ASLI baru di-load browser kalau user benar2 klik play
                      (preload="none"). */}
                  <div className="aspect-square bg-muted relative group">
                    {item.mediaType === "video" ? (
                      <video
                        src={previewUrl(item.fileUrl)}
                        poster={item.posterUrl ? previewUrl(item.posterUrl) : undefined}
                        preload="none"
                        controls
                        className="w-full h-full object-cover bg-black"
                      />
                    ) : failedIds.has(item.id) ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-center px-2">
                        <span className="text-xs text-muted-foreground">Gagal memuat gambar</span>
                        <Button
                          variant="ghost" size="sm" className="h-6 px-2 text-xs"
                          onClick={() => {
                            setFailedIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
                            setRetriedIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
                          }}
                        >
                          Coba lagi
                        </Button>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={retriedIds.has(item.id) ? `${previewUrl(item.fileUrl)}&retry=${Date.now()}` : previewUrl(item.fileUrl)}
                        alt={item.description}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={() => handleImageError(item.id)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      disabled={deletingId === item.id}
                      aria-label="Hapus footage ini"
                      className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-destructive transition-colors"
                    >
                      {deletingId === item.id ? "…" : "×"}
                    </button>
                  </div>
                  <div className="px-3 space-y-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">{item.mediaType === "video" ? "Video" : "Foto"}</Badge>
                      {item.categoryId && (
                        <Badge variant="secondary" className="text-xs">
                          {categoryNameById.get(item.categoryId) || "?"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    <Select
                      value={item.categoryId || UNCATEGORIZED}
                      onValueChange={(v) => handleAssignCategory(item.id, v || UNCATEGORIZED)}
                    >
                      <SelectTrigger className="w-full h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNCATEGORIZED}>Tanpa kategori</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
