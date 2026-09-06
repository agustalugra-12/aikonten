"use client";

import { useState } from "react";
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
// Lewatkan pratinjau logo lewat domain aplikasi sendiri, bukan hotlink langsung ke r2.dev
// (2026-08-06, laporan Agus - "logo yang di uploud tidak terlihat" - root cause SAMA dgn
// Bank Footage & DraftReview: domain pub-*.r2.dev kemungkinan besar kena blokir jaringan
// di sisi Agus, lihat catatan lengkap di api/media-proxy/route.ts).
function previewUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

// Content DNA (2026-08-26, PRD §4, Task Plan 5) - urutan+label dipakai form & save handler.
const IDENTITY_FIELDS = [
  "niche", "targetAudience", "positioning", "contentGoals", "toneOfVoice",
  "preferredTopics", "prohibitedTopics", "contentBoundaries", "eduEntertainmentRatio", "ctaStyle",
] as const;
const IDENTITY_LABELS: Record<(typeof IDENTITY_FIELDS)[number], { label: string; placeholder: string; long?: boolean }> = {
  niche: { label: "Niche", placeholder: "mis. jasa laundry rumahan area Denpasar" },
  targetAudience: { label: "Target Audience", placeholder: "mis. mahasiswa & karyawan sibuk di Denpasar" },
  positioning: { label: "Positioning", placeholder: "mis. laundry cepat & terjangkau, bukan premium" },
  contentGoals: { label: "Content Goals", placeholder: "mis. awareness area Denpasar + booking langsung" },
  toneOfVoice: { label: "Tone of Voice", placeholder: "mis. santai, akrab, bukan formal korporat" },
  preferredTopics: { label: "Topik Disukai", placeholder: "mis. tips cuci sepatu, promo bed cover villa", long: true },
  prohibitedTopics: { label: "Topik Dilarang", placeholder: "mis. jangan bandingkan harga kompetitor secara eksplisit", long: true },
  contentBoundaries: { label: "Batasan Konten", placeholder: "mis. jangan janji same-day di luar area Denpasar", long: true },
  eduEntertainmentRatio: { label: "Rasio Edukasi/Hiburan", placeholder: "mis. 70% edukasi, 30% hiburan" },
  ctaStyle: { label: "Gaya CTA", placeholder: "mis. selalu arahkan chat admin, bukan link bio" },
};
function identityFromBrand(b: Brand | null): Record<(typeof IDENTITY_FIELDS)[number], string> {
  return Object.fromEntries(IDENTITY_FIELDS.map((f) => [f, b?.[f] ?? ""])) as Record<(typeof IDENTITY_FIELDS)[number], string>;
}

function parseAutoPublishTimes(raw: string | null | undefined): string[] {
  if (!raw) return ["08:00"];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : ["08:00"];
  } catch {
    return ["08:00"];
  }
}

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

  const [knowledgeSite, setKnowledgeSite] = useState(brand?.knowledgeSite ?? "none");
  const [manualKnowledge, setManualKnowledge] = useState(brand?.manualKnowledge ?? "");
  const [posterBrandProfile, setPosterBrandProfile] = useState(brand?.posterBrandProfile ?? "");
  const [allowLogoInAiContent, setAllowLogoInAiContent] = useState(brand?.allowLogoInAiContent ?? false);
  const [logoInContentNote, setLogoInContentNote] = useState(brand?.logoInContentNote ?? "");
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  // Content DNA (2026-08-26, PRD §4, Task Plan 5) - 1 object state (bukan 10 useState
  // terpisah) krn semua field ini simetris: teks bebas, sama pola save/reset.
  const [identity, setIdentity] = useState<Record<(typeof IDENTITY_FIELDS)[number], string>>(identityFromBrand(brand));
  function updateIdentity(field: (typeof IDENTITY_FIELDS)[number], value: string) {
    setIdentity((prev) => ({ ...prev, [field]: value }));
  }

  const [videoCount, setVideoCount] = useState(brand?.dailyVideoCount ?? 7);
  const [fotoCount, setFotoCount] = useState(brand?.dailySinglePhotoCount ?? 3);
  const [carouselCount, setCarouselCount] = useState(brand?.dailyCarouselCount ?? 0);
  const [ytShortsCount, setYtShortsCount] = useState(brand?.dailyYoutubeShortsCount ?? 0);
  const [videoDuration, setVideoDuration] = useState(String(brand?.videoDurationTarget ?? 60));
  const [carouselPhotos, setCarouselPhotos] = useState(String(brand?.carouselPhotosPerPost ?? 5));
  const [orientation, setOrientation] = useState(brand?.videoOrientation ?? "portrait");
  const [stylePreset, setStylePreset] = useState(brand?.stylePreset ?? "energetic");
  const [publishMode, setPublishMode] = useState(brand?.publishMode ?? "draft");
  const [autoPublishTimes, setAutoPublishTimes] = useState<string[]>(parseAutoPublishTimes(brand?.autoPublishTimes));
  const [savingAutomation, setSavingAutomation] = useState(false);

  const [manualIdeaList, setManualIdeaList] = useState<
    { id: string; idea: string; source: string; used: boolean; createdAt: string }[] | null
  >(null);
  const [uploadingIdeas, setUploadingIdeas] = useState(false);

  // Sinkron ulang form saat dialog dibuka - brand bisa berubah (ganti brand aktif) atau
  // data terbaru masuk sejak terakhir dibuka. Dipindah ke event handler (bukan effect)
  // supaya tidak "setState synchronous di dalam effect" (react-hooks/set-state-in-effect).
  function resetForm() {
    setKnowledgeSite(brand?.knowledgeSite ?? "none");
    setManualKnowledge(brand?.manualKnowledge ?? "");
    setPosterBrandProfile(brand?.posterBrandProfile ?? "");
    setAllowLogoInAiContent(brand?.allowLogoInAiContent ?? false);
    setLogoInContentNote(brand?.logoInContentNote ?? "");
    setIdentity(identityFromBrand(brand));
    setVideoCount(brand?.dailyVideoCount ?? 7);
    setFotoCount(brand?.dailySinglePhotoCount ?? 3);
    setCarouselCount(brand?.dailyCarouselCount ?? 0);
    setYtShortsCount(brand?.dailyYoutubeShortsCount ?? 0);
    setVideoDuration(String(brand?.videoDurationTarget ?? 60));
    setCarouselPhotos(String(brand?.carouselPhotosPerPost ?? 5));
    setOrientation(brand?.videoOrientation ?? "portrait");
    setStylePreset(brand?.stylePreset ?? "energetic");
    setPublishMode(brand?.publishMode ?? "draft");
    setAutoPublishTimes(parseAutoPublishTimes(brand?.autoPublishTimes));
    fetch(`/api/brands/${brandId}/manual-ideas`)
      .then((r) => r.json())
      .then((d) => setManualIdeaList(d.ideas || []))
      .catch(() => setManualIdeaList([]));
  }

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
    if (allowLogoInAiContent && !logoInContentNote.trim()) {
      toast.error("Isi catatan dulu kalau mengizinkan logo/identitas di konten AI");
      return;
    }
    setSavingKnowledge(true);
    const identityPayload = Object.fromEntries(
      IDENTITY_FIELDS.map((f) => [f, identity[f].trim() || null])
    );
    const ok = await patchBrand({
      knowledgeSite: knowledgeSite === "none" ? null : knowledgeSite,
      manualKnowledge: manualKnowledge.trim() || null,
      posterBrandProfile: posterBrandProfile.trim() || null,
      allowLogoInAiContent,
      logoInContentNote: allowLogoInAiContent ? logoInContentNote.trim() : null,
      ...identityPayload,
    });
    setSavingKnowledge(false);
    if (ok) {
      toast.success("Knowledge Base disimpan");
      onChanged();
    }
  }

  const automationTotal = videoCount + fotoCount + carouselCount + ytShortsCount;
  const automationInvalid = automationTotal < 1;
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const autoPublishInvalid = publishMode === "auto" && (autoPublishTimes.length === 0 || !autoPublishTimes.every((t) => timeRe.test(t)));

  function handleAddPublishTime() {
    setAutoPublishTimes((prev) => [...prev, "12:00"]);
  }
  function handleRemovePublishTime(index: number) {
    setAutoPublishTimes((prev) => prev.filter((_, i) => i !== index));
  }
  function handleChangePublishTime(index: number, value: string) {
    setAutoPublishTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  }
  // Bantu Agus samakan jumlah slot jam dgn volume konten harian (2026-08-06, permintaan
  // Agus - "auto publis mau di publis jam brapa aja menyesuaikan dengan jumlah konten
  // yang ada") - sebar EVEN dari jam 08:00 s.d. 21:00 sejumlah automationTotal slot,
  // Agus tetap bisa edit manual tiap jamnya sesudahnya, ini cuma titik awal yg masuk akal.
  function handleSpreadPublishTimes() {
    const n = Math.max(1, automationTotal);
    const startMin = 8 * 60, endMin = 21 * 60;
    const step = n > 1 ? (endMin - startMin) / (n - 1) : 0;
    const times = Array.from({ length: n }, (_, i) => {
      const totalMin = Math.round(startMin + step * i);
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    });
    setAutoPublishTimes(times);
  }

  async function handleSaveAutomation() {
    if (automationInvalid) {
      toast.error("Total video + foto + carousel + YT Shorts harus minimal 1");
      return;
    }
    if (autoPublishInvalid) {
      toast.error("Jam auto-publish wajib diisi minimal 1 (format HH:MM) kalau mode Auto-Publish dipilih");
      return;
    }
    setSavingAutomation(true);
    const ok = await patchBrand({
      dailyVideoCount: videoCount,
      dailySinglePhotoCount: fotoCount,
      dailyCarouselCount: carouselCount,
      dailyYoutubeShortsCount: ytShortsCount,
      videoDurationTarget: Number(videoDuration),
      carouselPhotosPerPost: Number(carouselPhotos),
      videoOrientation: orientation,
      stylePreset,
      publishMode,
      autoPublishTimes: publishMode === "auto" ? autoPublishTimes : null,
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
      <Button variant="outline" onClick={() => { resetForm(); setOpen(true); }}>⚙️ Pengaturan Brand</Button>
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
                <img src={previewUrl(brand.logoUrl)} alt="Logo saat ini" className="w-16 h-16 rounded-full object-cover border" />
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
              <Select value={knowledgeSite} onValueChange={(v) => setKnowledgeSite(v || "none")}>
                <SelectTrigger id="knowledgeSite" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* "none" (2026-08-06, bug nyata - brand "laundry in bali" diam-diam
                      dapat fakta Pelangi Homestay krn dropdown ini SEBELUMNYA tidak py
                      opsi "tidak ada" sama sekali, jadi selalu default ke Pelangi) - WAJIB
                      dipilih eksplisit utk brand yg tidak terkait properti manapun. */}
                  <SelectItem value="none">Tidak ada (brand tidak terkait Pelangi/Harmoni)</SelectItem>
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
            <div className="space-y-1">
              <Label htmlFor="posterBrandProfile" className="text-xs">
                🎨 Profil Desain Poster (Brand Profile)
              </Label>
              <p className="text-xs text-muted-foreground">
                Warna, font, gaya ikon, tone, dan target audiens brand ini - dipakai bareng aturan desain umum
                (foto asli wajib, larangan mengarang harga/kontak/logo) supaya SEMUA poster brand ini punya identitas
                visual konsisten, walau layout/posisi teks tetap bisa beda-beda tiap poster. Kosongkan = pakai gaya
                netral (biru-putih polos), BUKAN warisan gaya brand lain.
              </p>
              <textarea
                id="posterBrandProfile"
                className="flex min-h-40 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs font-mono"
                value={posterBrandProfile}
                onChange={(e) => setPosterBrandProfile(e.target.value)}
                placeholder={"Contoh:\nWARNA: Biru tua #005D9E, putih, aksen oranye khusus promo.\nSTYLE: Modern minimalis, premium, terpercaya.\nICON: mesin cuci, setrika, water splash.\nTARGET AUDIENS: mahasiswa & karyawan sibuk."}
              />
            </div>
            <div className="space-y-2 border-t pt-4">
              <label htmlFor="allowLogoInAiContent" className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  id="allowLogoInAiContent"
                  className="mt-0.5"
                  checked={allowLogoInAiContent}
                  onChange={(e) => setAllowLogoInAiContent(e.target.checked)}
                />
                <span>
                  🔖 Izinkan AI menyertakan elemen logo/identitas (mis. ikon media sosial, badge brand) di gambar
                  yang di-generate untuk brand ini
                </span>
              </label>
              <p className="text-xs text-muted-foreground pl-6">
                DEFAULT (tidak dicentang): AI dilarang keras menaruh elemen apa pun yang menyerupai
                logo/identitas/badge di gambar - termasuk di zona pojok kanan-atas yang direservasi untuk logo
                asli brand (ditempel otomatis terpisah sesudahnya). Kalau dicentang, larangan itu dilonggarkan
                khusus brand ini.
              </p>
              <p className="text-xs text-amber-600 pl-6">
                ⚠️ Konsekuensi biaya: kalau hasil generate ternyata melanggar aturan desain lain (QC gagal),
                sistem otomatis generate ULANG 1x untuk perbaikan - artinya biaya kredit/token generate gambar
                bisa 2x lipat dari biasanya. Isi catatan di bawah untuk konfirmasi brand/owner sudah paham &amp;
                setuju.
              </p>
              {allowLogoInAiContent && (
                <div className="space-y-1 pl-6">
                  <Label htmlFor="logoInContentNote" className="text-xs">
                    Catatan konfirmasi (wajib diisi)
                  </Label>
                  <textarea
                    id="logoInContentNote"
                    className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                    value={logoInContentNote}
                    onChange={(e) => setLogoInContentNote(e.target.value)}
                    placeholder="Contoh: Owner AgustaP sudah setuju biaya generate bisa 2x lipat karena desainnya butuh ikon media sosial."
                  />
                </div>
              )}
            </div>
            <div className="space-y-3 border-t pt-4">
              <div>
                <Label className="text-xs">🧬 Identitas Brand (Content DNA)</Label>
                <p className="text-xs text-muted-foreground">
                  Konteks arah/gaya konten - dipakai AI saat bikin caption/naskah & menilai kecocokan brand. Opsional,
                  isi apa yang relevan saja.
                </p>
              </div>
              {IDENTITY_FIELDS.filter((f) => !IDENTITY_LABELS[f].long).map((f) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={f} className="text-xs">{IDENTITY_LABELS[f].label}</Label>
                  <Input
                    id={f}
                    value={identity[f]}
                    onChange={(e) => updateIdentity(f, e.target.value)}
                    placeholder={IDENTITY_LABELS[f].placeholder}
                  />
                </div>
              ))}
              {IDENTITY_FIELDS.filter((f) => IDENTITY_LABELS[f].long).map((f) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={f} className="text-xs">{IDENTITY_LABELS[f].label}</Label>
                  <textarea
                    id={f}
                    className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                    value={identity[f]}
                    onChange={(e) => updateIdentity(f, e.target.value)}
                    placeholder={IDENTITY_LABELS[f].placeholder}
                  />
                </div>
              ))}
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
            <p className="text-xs rounded-md border bg-muted/50 p-2.5">
              🤖 <strong>Semuanya berjalan otomatis setiap hari</strong> - Ide dibuatkan jam 03:00 WITA, lalu KONTENNYA
              (video/foto/carousel) langsung digenerate otomatis jam 03:15 WITA mengikuti volume di bawah, TIDAK perlu
              klik apa pun. Mode publikasi di bawah cuma menentukan langkah TERAKHIR: <strong>Draft</strong> = hasilnya
              nunggu Bapak klik publish manual, <strong>Auto-Publish</strong> = hasilnya diterbitkan sendiri sesuai jam
              yang diatur.
            </p>
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
                <div className="space-y-1">
                  <Label htmlFor="ytShortsCount" className="text-xs">🩳 YT Shorts</Label>
                  <Input id="ytShortsCount" type="number" min={0} value={ytShortsCount}
                    onChange={(e) => setYtShortsCount(Math.max(0, Number(e.target.value) || 0))} className="w-20" />
                </div>
              </div>
              {ytShortsCount > 0 && (
                <p className="text-xs rounded-md border bg-muted/50 p-2">
                  🩳 Video YT Shorts SELALU vertical (9:16) &amp; maksimal 60 detik, walau pengaturan Orientasi/Durasi di
                  bawah disetel beda (mis. brand bisa sekaligus punya video landscape panjang utk YouTube reguler DAN
                  video pendek utk YouTube Shorts). Butuh akun YouTube yang sudah terhubung (tab Akun Sosmed) supaya
                  benar-benar terbit ke YouTube - kalau belum terhubung, video tetap dibuat tapi publish akan gagal.
                </p>
              )}
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
                  <SelectItem value="180">3 menit (YT panjang)</SelectItem>
                  <SelectItem value="300">5 menit (YT panjang)</SelectItem>
                  <SelectItem value="480">8 menit (YT panjang)</SelectItem>
                </SelectContent>
              </Select>
              {Number(videoDuration) >= 180 && (
                <p className="text-xs text-amber-600">
                  Durasi panjang butuh banyak footage asli/B-roll. Kalau footage bank brand ini masih sedikit, video bisa banyak diisi B-roll stok.
                </p>
              )}
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
                cuma relevan dipakai kalau ini landscape. Square (1:1) untuk feed IG/FB biasa (bukan Reels).
              </p>
              <Select value={orientation} onValueChange={(v) => setOrientation(v as "portrait" | "landscape" | "square")}>
                <SelectTrigger id="orientation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait (9:16 - IG/TikTok)</SelectItem>
                  <SelectItem value="landscape">Landscape (16:9 - YouTube)</SelectItem>
                  <SelectItem value="square">Square (1:1 - Feed IG/FB)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="stylePreset" className="text-xs">🎬 Gaya editing</Label>
              <p className="text-xs text-muted-foreground">
                Energetic: motion cepat, transisi tegas, progress bar+sticker aktif - cocok Shorts/TikTok cepat.
                Documentary: motion halus, transisi fade saja, tanpa progress bar/sticker - cocok konten
                edukasi/dokumenter. Minimal: nyaris statis, transisi fade polos saja, paling bersih/premium.
              </p>
              <Select value={stylePreset} onValueChange={(v) => setStylePreset(v as "energetic" | "documentary" | "minimal")}>
                <SelectTrigger id="stylePreset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="energetic">Energetic (cepat & tegas)</SelectItem>
                  <SelectItem value="documentary">Documentary (halus & tenang)</SelectItem>
                  <SelectItem value="minimal">Minimal (bersih & premium)</SelectItem>
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
              <div className="space-y-2">
                <Label className="text-xs">⏰ Jam auto-publish (WITA)</Label>
                <p className="text-xs text-muted-foreground">
                  Tiap jam di sini menerbitkan TEPAT 1 konten (bukan semua sekaligus) - konten tersebar rapi sepanjang
                  hari. Kalau konten hari ini lebih banyak dari jumlah jam di sini, sisanya nunggu jam besok - samakan
                  jumlah jam dgn total konten harian ({automationTotal}) biar semua kebagian hari itu juga.
                </p>
                <div className="space-y-1.5">
                  {autoPublishTimes.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={t}
                        onChange={(e) => handleChangePublishTime(i, e.target.value)}
                        className="w-32"
                      />
                      <Button
                        variant="ghost" size="sm" className="h-8 px-2"
                        onClick={() => handleRemovePublishTime(i)}
                        disabled={autoPublishTimes.length <= 1}
                      >
                        Hapus
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleAddPublishTime}>+ Tambah jam</Button>
                  <Button variant="outline" size="sm" onClick={handleSpreadPublishTimes}>
                    ⚡ Sebar otomatis ({automationTotal} slot)
                  </Button>
                </div>
                {autoPublishInvalid && <p className="text-xs text-destructive">Minimal 1 jam wajib diisi, format HH:MM</p>}
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
