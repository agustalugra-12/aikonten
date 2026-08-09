"use client";

import { useState, useEffect } from "react";
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
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Channel Profile / Editorial Policy (2026-08-10, PRD Agus "YouTube Long Form Content
// Engine" + "YouTube Shorts Engine") - satu-satunya form yang Agus benar-benar perlu isi
// utk engine ini jalan ("reusable aja siapa tau aku mau buat channel lain" - dibuat per
// AKUN YouTube, bukan per brand, jadi channel kedua nanti isi form-nya sendiri). Series/
// rotasi topik/struktur naskah SEMUA otomatis di belakang layar (youtubeEditorial.ts),
// TIDAK perlu UI terpisah - niche & kategori di sini sudah cukup jadi input-nya.
type ChannelProfileData = {
  primaryNiche: string;
  contentPillars: string[];
  forbiddenTopics: string[];
  preferredTopics: string[];
  language: string;
  targetCountry: string;
  targetAudience: string;
  youtubeCategoryId: string;
};

const EMPTY: ChannelProfileData = {
  primaryNiche: "",
  contentPillars: [],
  forbiddenTopics: [],
  preferredTopics: [],
  language: "",
  targetCountry: "",
  targetAudience: "",
  youtubeCategoryId: "",
};

// Daftar KATEGORI RESMI YouTube via Buffer (2026-08-10, dari INTROSPEKSI GraphQL Buffer
// - metadata.youtube.categoryId "Required on create", TANPA ini publish akan DITOLAK
// Buffer, lihat orchestrate.ts/buffer.ts) - persis daftar ID yang dikembalikan skema
// resmi Buffer, bukan daftar kategori YouTube publik yang lebih panjang (Buffer cuma
// dukung subset ini).
const YOUTUBE_CATEGORIES: { id: string; label: string }[] = [
  { id: "1", label: "Film & Animation" },
  { id: "2", label: "Autos & Vehicles" },
  { id: "10", label: "Music" },
  { id: "15", label: "Pets & Animals" },
  { id: "17", label: "Sports" },
  { id: "19", label: "Travel & Events" },
  { id: "20", label: "Gaming" },
  { id: "22", label: "People & Blogs" },
  { id: "23", label: "Comedy" },
  { id: "24", label: "Entertainment" },
  { id: "25", label: "News & Politics" },
  { id: "26", label: "Howto & Style" },
  { id: "27", label: "Education" },
  { id: "28", label: "Science & Technology" },
  { id: "29", label: "Nonprofits & Activism" },
];

function linesToArray(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}
function arrayToLines(arr: string[]): string {
  return arr.join("\n");
}

export function ChannelProfileDialog({ socialAccountId, username }: { socialAccountId: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [primaryNiche, setPrimaryNiche] = useState("");
  const [contentPillars, setContentPillars] = useState("");
  const [forbiddenTopics, setForbiddenTopics] = useState("");
  const [preferredTopics, setPreferredTopics] = useState("");
  const [language, setLanguage] = useState("");
  const [targetCountry, setTargetCountry] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [youtubeCategoryId, setYoutubeCategoryId] = useState("22");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/social-accounts/${socialAccountId}/channel-profile`)
      .then((r) => r.json())
      .then((d: ChannelProfileData | null) => {
        const data = d || EMPTY;
        setPrimaryNiche(data.primaryNiche || "");
        setContentPillars(arrayToLines(data.contentPillars || []));
        setForbiddenTopics(arrayToLines(data.forbiddenTopics || []));
        setPreferredTopics(arrayToLines(data.preferredTopics || []));
        setLanguage(data.language || "English");
        setTargetCountry(data.targetCountry || "");
        setTargetAudience(data.targetAudience || "");
        setYoutubeCategoryId(data.youtubeCategoryId || "22");
      })
      .finally(() => setLoading(false));
  }, [open, socialAccountId]);

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/social-accounts/${socialAccountId}/channel-profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryNiche: primaryNiche.trim() || null,
        contentPillars: linesToArray(contentPillars),
        forbiddenTopics: linesToArray(forbiddenTopics),
        preferredTopics: linesToArray(preferredTopics),
        language: language.trim() || null,
        targetCountry: targetCountry.trim() || null,
        targetAudience: targetAudience.trim() || null,
        youtubeCategoryId: youtubeCategoryId || null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || "Gagal simpan editorial policy");
      return;
    }
    toast.success("Editorial policy tersimpan - berlaku mulai batch ide berikutnya");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">🎬 Editorial Policy</Button>} />
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editorial Policy - @{username}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-xs rounded-md border bg-muted/50 p-2.5">
              🎬 Ini adalah "otak" AI YouTube Content Engine channel ini - niche &amp; kategori di sini yang
              menentukan seri/topik apa yang otomatis dibuat AI (rotasi kategori, seri episode, larangan topik
              tertentu, dst - lihat PRD). Kosongkan semua = channel ini belum pakai engine editorial khusus
              (fallback ke ide konten generik biasa).
            </p>
            <div className="space-y-1">
              <Label htmlFor="primaryNiche" className="text-xs">🎯 Niche utama</Label>
              <Input id="primaryNiche" value={primaryNiche} onChange={(e) => setPrimaryNiche(e.target.value)}
                placeholder="mis. Animal facts & wildlife documentary" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contentPillars" className="text-xs">📦 Kategori konten (1 per baris - AI akan merotasi ini)</Label>
              <textarea id="contentPillars" className="flex min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                value={contentPillars} onChange={(e) => setContentPillars(e.target.value)}
                placeholder={"Animal Mysteries\nAnimal Intelligence\nAmazing Animal Facts\nAnimal Behavior\nRare Animals\nNature Documentary\nAnimal Comparisons"} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="preferredTopics" className="text-xs">✅ Topik prioritas (opsional, 1 per baris)</Label>
              <textarea id="preferredTopics" className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                value={preferredTopics} onChange={(e) => setPreferredTopics(e.target.value)}
                placeholder="Kosongkan kalau tidak ada preferensi spesifik" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="forbiddenTopics" className="text-xs">🚫 Topik terlarang (opsional, 1 per baris)</Label>
              <textarea id="forbiddenTopics" className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
                value={forbiddenTopics} onChange={(e) => setForbiddenTopics(e.target.value)}
                placeholder="mis. exotic pet trade, animal cruelty" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="language" className="text-xs">🌐 Bahasa naskah</Label>
                <Input id="language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="English" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="targetCountry" className="text-xs">🌍 Target negara</Label>
                <Input id="targetCountry" value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} placeholder="mis. US, Global" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="targetAudience" className="text-xs">👥 Target audiens</Label>
              <Input id="targetAudience" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="mis. animal lovers usia 18-45, penonton dokumenter/edukasi" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="youtubeCategoryId" className="text-xs">📺 Kategori YouTube</Label>
              <p className="text-xs text-muted-foreground">Wajib diisi Buffer setiap upload ke YouTube - pilih yang paling sesuai isi channel.</p>
              <Select value={youtubeCategoryId} onValueChange={(v) => setYoutubeCategoryId(v || "22")}>
                <SelectTrigger id="youtubeCategoryId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YOUTUBE_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan Editorial Policy"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
