"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Brand } from "@/types";

// Pengaturan Brand terkonsolidasi (2026-08-05, permintaan Agus - "aku mau setiap brand
// bisa mengisi pengetahuan secara manual, kamu mungkin bisa buat sidebarnya, jadi
// disana ada logo, pengetahuan, dan... side bar automation") - GANTIKAN BrandLogoDialog
// (dipindah ke sini, bukan dihapus fiturnya) + mini-panel ⚙️ yg sebelumnya ada di
// DailyContentPlanner.tsx (dipindah krn makin banyak setting, lebih baik 1 tempat
// terpusat drpd 2 dialog kecil terpisah yg tumpang tindih).
//
// 3 tab: Logo, Knowledge Base (auto site + manual), Automation (volume harian 3 tipe,
// durasi video, foto/carousel, orientasi). Semua field OPSIONAL saat PATCH - kirim yg
// berubah saja per tab save button, bukan 1 form raksasa sekali submit (lebih jelas
// mana yg baru tersimpan, error 1 tab tidak menggagalkan tab lain).
export function BrandSettingsSidebar({
  brandId,
  brand,
  onChanged,
}: {
  brandId: string;
  brand: Brand | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [knowledgeSite, setKnowledgeSite] = useState(brand?.knowledgeSite ?? "pelangi");
  const [manualKnowledge, setManualKnowledge] = useState(brand?.manualKnowledge ?? "");
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  const [videoCount, setVideoCount] = useState(brand?.dailyVideoCount ?? 7);
  const [fotoCount, setFotoCount] = useState(brand?.dailySinglePhotoCount ?? 3);
  const [carouselCount, setCarouselCount] = useState(brand?.dailyCarouselCount ?? 0);
  const [videoDuration, setVideoDuration] = useState(String(brand?.videoDurationTarget ?? 60));
  const [carouselPhotos, setCarouselPhotos] = useState(String(brand?.carouselPhotosPerPost ?? 5));
  const [orientation, setOrientation] = useState(brand?.videoOrientation ?? "portrait");
  const [publishMode, setPublishMode] = useState(brand?.publishMode ?? "draft");
  const [autoPublishTime, setAutoPublishTime] = useState(brand?.autoPublishTime ?? "08:00");
  const [savingAutomation, setSavingAutomation] = useState(false);

  const [manualIdeaList, setManualIdeaList] = useState<
    { id: string; idea: string; source: string; used: boolean; createdAt: string }[] | null
  >(null);
  const [uploadingIdeas, setUploadingIdeas] = useState(false);

  // Sinkron ulang tiap dialog dibuka - brand bisa berubah (ganti brand aktif) atau
  // data terbaru masuk sejak terakhir dibuka.
  useEffect(() => {
    if (!open) return;
    setKnowledgeSite(brand?.knowledgeSite ?? "pelangi");
    setManualKnowledge(brand?.manualKnowledge ?? "");
    setVideoCount(brand?.dailyVideoCount ?? 7);
    setFotoCount(brand?.dailySinglePhotoCount ?? 3);
    setCarouselCount(brand?.dailyCarouselCount ?? 0);
    setVideoDuration(String(brand?.videoDurationTarget ?? 60));
    setCarouselPhotos(String(brand?.carouselPhotosPerPost ?? 5));
    setOrientation(brand?.videoOrientation ?? "portrait");
    setPublishMode(brand?.publishMode ?? "draft");
    setAutoPublishTime(brand?.autoPublishTime ?? "08:00");
    fetch(`/api/brands/${brandId}/manual-ideas`)
      .then((r) => r.json())
      .then((d) => setManualIdeaList(d.ideas || []))
      .catch(() => setManualIdeaList([]));
  }, [open, brand, brandId]);

  async function patchBrand(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/brands/${brandId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Gagal simpan pengaturan");
      return false;
    }
    return true;
  }

  async function handleUploadLogo(files: FileList | null) {
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

      const ok = await patchBrand({ logoUrl: publicUrl });
      if (ok) {
        toast.success("Logo brand tersimpan");
        onChanged();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal upload logo");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveLogo() {
    const ok = await patchBrand({ logoUrl: null });
    if (ok) {
      toast.success("Logo brand dihapus");
      onChanged();
    }
  }

  async function handleSaveKnowledge() {
    setSavingKnowledge(true);
    const ok = await patchBrand({ knowledgeSite, manualKnowledge: manualKnowledge.trim() || null });
    setSavingKnowledge(false);
    if (ok) {
      toast.success("Knowledge Base disimpan");
      onChanged();
    }
  }

  const automationTotal = videoCount + fotoCount + carouselCount;
  const automationInvalid = automationTotal < 1;
  const autoPublishInvalid = publishMode === "auto" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(autoPublishTime);

  async function handleSaveAutomation() {
    if (automationInvalid) {
      toast.error("Total video + foto + carousel harus minimal 1");
      return;
    }
    if (autoPublishInvalid) {
      toast.error("Jam auto-publish wajib diisi (format HH:MM) kalau mode Auto-Publish dipilih");
      return;
    }
    setSavingAutomation(true);
    const ok = await patchBrand({
      dailyVideoCount: videoCount,
      dailySinglePhotoCount: fotoCount,
      dailyCarouselCount: carouselCount,
      videoDurationTarget: Number(videoDuration),
      carouselPhotosPerPost: Number(carouselPhotos),
      videoOrientation: orientation,
      publishMode,
      autoPublishTime: publishMode === "auto" ? autoPublishTime : null,
    });
    setSavingAutomation(false);
    if (ok) {
      toast.success("Pengaturan otomasi disimpan - berlaku mulai batch berikutnya (buat ulang rencana konten, atau otomatis besok)");
      onChanged();
    }
  }

  async function handleUploadIdeas(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploadingIdeas(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/brands/${brandId}/manual-ideas`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal upload ide");
      toast.success(`${data.count} ide berhasil ditambahkan ke Bank Ide`);
      const listRes = await fetch(`/api/brands/${brandId}/manual-ideas`);
      setManualIdeaList((await listRes.json()).ideas || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal upload ide");
    } finally {
      setUploadingIdeas(false);
    }
  }

  async function handleDeleteIdea(ideaId: string) {
    await fetch(`/api/brands/${brandId}/manual-ideas`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaId }),
    });
    setManualIdeaList((prev) => prev?.filter((i) => i.id !== ideaId) ?? null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">⚙️ Pengaturan Brand</Button>} />
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pengaturan Brand</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="logo">
          <TabsList className="w-full">
            <TabsTrigger value="logo">Logo</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
            <TabsTrigger value="ideabank">Bank Ide</TabsTrigger>
            <TabsTrigger value="automation">Automation</TabsTrigger>
          </TabsList>

          <TabsContent value="logo" className="space-y-4 pt-3">
            <p className="text-sm text-muted-foreground">
              Logo ini otomatis ditempel (lingkaran, ukuran proporsional, pojok kanan-atas) di setiap foto &amp; video
              hasil AI berikutnya. Kosongkan kalau tidak mau pakai watermark logo.
            </p>
            {brand?.logoUrl && (
              <div className="flex items-center gap-3">
                <img src={brand.logoUrl} alt="Logo saat ini" className="w-16 h-16 rounded-full object-cover border" />
                <Button variant="ghost" size="sm" onClick={handleRemoveLogo}>
                  Hapus logo
                </Button>
              </div>
            )}
            <Input type="file" accept="image/*" onChange={(e) => handleUploadLogo(e.target.files)} disabled={uploading} />
            {uploading && <p className="text-xs text-muted-foreground">Mengunggah logo...</p>}
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-4 pt-3">
            <div className="space-y-1">
              <Label htmlFor="knowledgeSite" className="text-xs">
                📚 Properti sumber data otomatis
              </Label>
              <p className="text-xs text-muted-foreground">
                AI ambil fakta kamar/harga/fasilitas LIVE dari PMS &amp; website properti ini, supaya ide &amp; caption
                tidak keluar jalur.
              </p>
              <Select value={knowledgeSite} onValueChange={(v) => setKnowledgeSite(v || "pelangi")}>
                <SelectTrigger id="knowledgeSite" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pelangi">Pelangi Homestay</SelectItem>
                  <SelectItem value="harmoni">Harmoni Hills</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="manualKnowledge" className="text-xs">
                ✍️ Pengetahuan tambahan (manual)
              </Label>
              <p className="text-xs text-muted-foreground">
                Melengkapi (bukan menggantikan) fakta otomatis di atas - mis. promo bulan ini, penekanan khusus, atau
                info yang belum ada di PMS/website.
              </p>
              <textarea
                id="manualKnowledge"
                className="flex min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                value={manualKnowledge}
                onChange={(e) => setManualKnowledge(e.target.value)}
                placeholder="Contoh: Bulan Agustus ada promo long stay 7 malam diskon 15%. Fokuskan konten ke suasana kerja remote yang tenang."
              />
            </div>
            <Button size="sm" onClick={handleSaveKnowledge} disabled={savingKnowledge}>
              {savingKnowledge ? "Menyimpan..." : "Simpan Knowledge Base"}
            </Button>
          </TabsContent>

          <TabsContent value="ideabank" className="space-y-4 pt-3">
            <p className="text-sm text-muted-foreground">
              Upload ide konten sendiri (.xlsx, .xls, atau .pdf - 1 ide per baris). Ide di sini dipakai LEBIH DULU
              tiap rencana konten harian dibuat, AI cuma isi sisa slot yang belum terpenuhi.
            </p>
            <Input type="file" accept=".xlsx,.xls,.pdf" onChange={(e) => handleUploadIdeas(e.target.files)} disabled={uploadingIdeas} />
            {uploadingIdeas && <p className="text-xs text-muted-foreground">Mengunggah &amp; membaca ide...</p>}

            {manualIdeaList === null ? (
              <p className="text-xs text-muted-foreground">Memuat...</p>
            ) : manualIdeaList.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada ide manual - upload file di atas.</p>
            ) : (
              <ul className="space-y-1.5 max-h-60 overflow-y-auto">
                {manualIdeaList.map((i) => (
                  <li key={i.id} className="flex items-start gap-2 text-xs rounded-md border p-2">
                    <span className="flex-1">
                      {i.idea}
                      <span className="block text-muted-foreground mt-0.5">
                        {i.source} {i.used ? "· sudah dipakai" : "· belum dipakai"}
                      </span>
                    </span>
                    {!i.used && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 shrink-0" onClick={() => handleDeleteIdea(i.id)}>
                        Hapus
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="automation" className="space-y-4 pt-3">
            <div className="space-y-2">
              <Label className="text-xs">📦 Volume konten harian per tipe</Label>
              <p className="text-xs text-muted-foreground">
                Bebas berapa pun tiap tipe (mis. 4 foto + 4 video + 4 carousel = 12 konten/hari) - rencana konten harian
                mengikuti total ini.
              </p>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1">
                  <Label htmlFor="videoCount" className="text-xs">🎬 Video</Label>
                  <Input id="videoCount" type="number" min={0} value={videoCount}
                    onChange={(e) => setVideoCount(Math.max(0, Number(e.target.value) || 0))} className="w-20" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fotoCount" className="text-xs">📷 Foto (poster)</Label>
                  <Input id="fotoCount" type="number" min={0} value={fotoCount}
                    onChange={(e) => setFotoCount(Math.max(0, Number(e.target.value) || 0))} className="w-20" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="carouselCount" className="text-xs">🖼️ Carousel</Label>
                  <Input id="carouselCount" type="number" min={0} value={carouselCount}
                    onChange={(e) => setCarouselCount(Math.max(0, Number(e.target.value) || 0))} className="w-20" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Total: {automationTotal} konten/hari</p>
              {automationInvalid && <p className="text-xs text-destructive">Total harus minimal 1</p>}
            </div>

            <div className="space-y-1">
              <Label htmlFor="videoDuration" className="text-xs">⏱️ Durasi target video</Label>
              <Select value={videoDuration} onValueChange={(v) => setVideoDuration(v || "60")}>
                <SelectTrigger id="videoDuration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 detik</SelectItem>
                  <SelectItem value="60">60 detik</SelectItem>
                  <SelectItem value="90">1 menit 30 detik</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="carouselPhotos" className="text-xs">🖼️ Jumlah foto per post carousel</Label>
              <Select value={carouselPhotos} onValueChange={(v) => setCarouselPhotos(v || "5")}>
                <SelectTrigger id="carouselPhotos" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 foto</SelectItem>
                  <SelectItem value="5">5 foto</SelectItem>
                  <SelectItem value="7">7 foto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="orientation" className="text-xs">📐 Orientasi video</Label>
              <p className="text-xs text-muted-foreground">
                Portrait (9:16) untuk IG/TikTok Reels. Landscape (16:9) untuk YouTube - thumbnail otomatis khusus YT
                cuma relevan dipakai kalau ini landscape.
              </p>
              <Select value={orientation} onValueChange={(v) => setOrientation(v as "portrait" | "landscape")}>
                <SelectTrigger id="orientation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait (9:16 - IG/TikTok)</SelectItem>
                  <SelectItem value="landscape">Landscape (16:9 - YouTube)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 pt-1 border-t">
              <Label htmlFor="publishMode" className="text-xs">🚀 Mode publikasi</Label>
              <p className="text-xs text-muted-foreground">
                Draft: konten digenerate lalu MENUNGGU klik manual Agus utk publish (spt sekarang). Auto-Publish:
                konten tetap digenerate sama persis, TAPI otomatis dipublikasikan sendiri begitu jam di bawah tiba -
                tidak perlu klik manual.
              </p>
              <Select value={publishMode} onValueChange={(v) => setPublishMode((v || "draft") as "draft" | "auto")}>
                <SelectTrigger id="publishMode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft (publish manual)</SelectItem>
                  <SelectItem value="auto">Auto-Publish (terjadwal)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {publishMode === "auto" && (
              <div className="space-y-1">
                <Label htmlFor="autoPublishTime" className="text-xs">⏰ Jam auto-publish (WITA)</Label>
                <Input
                  id="autoPublishTime"
                  type="time"
                  value={autoPublishTime}
                  onChange={(e) => setAutoPublishTime(e.target.value)}
                  className="w-32"
                />
                {autoPublishInvalid && <p className="text-xs text-destructive">Jam wajib diisi</p>}
              </div>
            )}

            <Button size="sm" onClick={handleSaveAutomation} disabled={savingAutomation || automationInvalid || autoPublishInvalid}>
              {savingAutomation ? "Menyimpan..." : "Simpan Automation"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
