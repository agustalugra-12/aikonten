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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Brand } from "@/types";

type DailyIdea = {
  id: string;
  idea: string;
  used: boolean;
  score: number | null;
  reasoning: string | null;
  contentType: "video" | "carousel" | null;
};

function scoreColor(score: number): string {
  if (score >= 75) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (score >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  return "bg-muted text-muted-foreground";
}

const DAILY_TOTAL = 10;

// AI Content Planner (2026-08-05, permintaan Agus, PRD "AI Content Brain" modul 10 -
// "setiap pagi AI membuat 10 ide") - BEDA dari ContentIdeas.tsx (itu on-demand 3-5 ide
// baru tiap diklik, tidak tersimpan) - ini batch 10 ide TETAP sepanjang hari (sama
// walau dashboard dibuka berkali-kali), digenerate SEKALI per hari WITA
// (dailyContentPlanner.ts), grounded ke Knowledge Base Pelangi asli.
//
// Opportunity Finder (2026-08-05) - tiap ide dapat score 0-100 + reasoning (kenapa)
// dari suggestScoredContentIdeas, diurutkan skor tertinggi dulu - sesuai PRD Agus
// ("memberi skor setiap ide berdasarkan relevansi/potensi menarik/variasi/dukungan
// keyword utama").
//
// Video:Foto split (2026-08-05, permintaan Agus - "dari 10 konten ini 3 dibuat foto 7
// dibuat video") - setting per-brand (brands.dailyVideoCount/dailyCarouselCount, lihat
// route.ts PATCH), tiap ide dapat contentType yg AI sarankan, Agus tetap bisa ganti
// manual di NewProjectDialog. onPickIdea kirim (script, type) skalian.
export function DailyContentPlanner({
  brandId,
  brand,
  onPickIdea,
  onSettingsChanged,
}: {
  brandId: string;
  brand: Brand | null;
  onPickIdea: (script: string, type?: "video" | "carousel") => void;
  onSettingsChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [ideas, setIdeas] = useState<DailyIdea[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [videoCount, setVideoCount] = useState(brand?.dailyVideoCount ?? 7);
  const [carouselCount, setCarouselCount] = useState(brand?.dailyCarouselCount ?? 3);
  const [knowledgeSite, setKnowledgeSite] = useState(brand?.knowledgeSite ?? "pelangi");
  const [savingSettings, setSavingSettings] = useState(false);

  async function loadIdeas() {
    setLoading(true);
    const res = await fetch(`/api/brands/${brandId}/daily-ideas`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error || "Gagal ambil rencana konten hari ini");
      setIdeas([]);
      return;
    }
    setIdeas(data.ideas);
  }

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setVideoCount(brand?.dailyVideoCount ?? 7);
      setCarouselCount(brand?.dailyCarouselCount ?? 3);
      setKnowledgeSite(brand?.knowledgeSite ?? "pelangi");
      if (ideas === null) await loadIdeas();
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    const res = await fetch(`/api/brands/${brandId}/daily-ideas`, { method: "POST" });
    const data = await res.json();
    setRegenerating(false);
    if (!res.ok) {
      toast.error(data.error || "Gagal buat ulang rencana konten");
      return;
    }
    setIdeas(data.ideas);
    toast.success("Rencana konten hari ini diperbarui");
  }

  async function handleSaveSettings() {
    if (videoCount + carouselCount !== DAILY_TOTAL) {
      toast.error(`Total video + foto harus ${DAILY_TOTAL} (sekarang ${videoCount + carouselCount})`);
      return;
    }
    setSavingSettings(true);
    const res = await fetch(`/api/brands/${brandId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyVideoCount: videoCount, dailyCarouselCount: carouselCount, knowledgeSite }),
    });
    const data = await res.json();
    setSavingSettings(false);
    if (!res.ok) {
      toast.error(data.error || "Gagal simpan pengaturan");
      return;
    }
    toast.success("Pengaturan disimpan - berlaku mulai batch berikutnya (buat ulang sekarang, atau otomatis besok)");
    onSettingsChanged();
    setShowSettings(false);
  }

  async function handlePick(idea: DailyIdea) {
    // Tandai dipakai (best-effort, tidak blocking). Ide yang sudah dipakai LANGSUNG
    // HILANG dari daftar (2026-08-05, permintaan Agus - "setiap konten dikerjakan ide
    // konten otomatis menghilang") - bukan cuma badge "sudah dipakai" spt sebelumnya,
    // lihat visibleIdeas di bawah. "🔄 Buat Ulang" tetap mengembalikan rencana ke 10 ide
    // baru (handleRegenerate, sudah ada) - tidak ada perubahan di situ.
    fetch(`/api/brands/${brandId}/daily-ideas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaId: idea.id }),
    }).catch(() => {});
    setIdeas((prev) => prev?.map((i) => (i.id === idea.id ? { ...i, used: true } : i)) ?? null);
    onPickIdea(idea.idea, idea.contentType ?? undefined);
    setOpen(false);
  }

  const visibleIdeas = ideas?.filter((i) => !i.used) ?? [];
  const settingsSumInvalid = videoCount + carouselCount !== DAILY_TOTAL;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">📅 Rencana Konten Hari Ini</Button>} />
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rencana Konten Hari Ini</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {DAILY_TOTAL} ide baru tiap hari ({brand?.dailyVideoCount ?? 7} video, {brand?.dailyCarouselCount ?? 3} foto) -
              tetap sama sepanjang hari ini kecuali dibuat ulang. {ideas && ideas.length > 0 ? `${visibleIdeas.length} dari ${DAILY_TOTAL} belum dikerjakan.` : ""}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setShowSettings((v) => !v)}>
                ⚙️
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRegenerate} disabled={regenerating || loading}>
                {regenerating ? "Membuat ulang..." : "🔄 Buat Ulang"}
              </Button>
            </div>
          </div>

          {showSettings && (
            <div className="rounded-md border p-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Atur berapa dari {DAILY_TOTAL} ide harian yang jadi video vs foto. AI yang pilih ide mana cocok jadi
                format apa.
              </p>
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="videoCount" className="text-xs">
                    🎬 Video
                  </Label>
                  <Input
                    id="videoCount"
                    type="number"
                    min={0}
                    max={DAILY_TOTAL}
                    value={videoCount}
                    onChange={(e) => setVideoCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="carouselCount" className="text-xs">
                    📷 Foto
                  </Label>
                  <Input
                    id="carouselCount"
                    type="number"
                    min={0}
                    max={DAILY_TOTAL}
                    value={carouselCount}
                    onChange={(e) => setCarouselCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20"
                  />
                </div>
                <Button size="sm" onClick={handleSaveSettings} disabled={savingSettings || settingsSumInvalid}>
                  {savingSettings ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
              {settingsSumInvalid && (
                <p className="text-xs text-destructive">Total harus {DAILY_TOTAL} (sekarang {videoCount + carouselCount})</p>
              )}
              <div className="space-y-1 pt-1 border-t">
                <Label htmlFor="knowledgeSite" className="text-xs">
                  📚 Knowledge Base - properti sumber data
                </Label>
                <p className="text-xs text-muted-foreground">
                  AI ambil fakta kamar/harga/fasilitas dari properti ini supaya ide & caption tidak keluar jalur.
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
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Menyusun rencana konten hari ini...</p>
          ) : !ideas || ideas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada ide - coba lagi nanti.</p>
          ) : visibleIdeas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Semua {DAILY_TOTAL} ide hari ini sudah dikerjakan - klik &quot;🔄 Buat Ulang&quot; kalau mau rencana baru.
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleIdeas.map((idea) => (
                <li key={idea.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(idea)}
                    className="w-full text-left text-sm rounded-md border p-3 hover:bg-muted transition-colors space-y-1"
                  >
                    <div className="flex items-start gap-2">
                      {idea.score !== null && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${scoreColor(idea.score)}`}>
                          {idea.score}
                        </span>
                      )}
                      {idea.contentType && (
                        <span className="shrink-0 text-xs" title={idea.contentType === "video" ? "Video" : "Foto"}>
                          {idea.contentType === "video" ? "🎬" : "📷"}
                        </span>
                      )}
                      <span className="flex-1">{idea.idea}</span>
                    </div>
                    {idea.reasoning && (
                      <p className="text-xs text-muted-foreground pl-0.5">{idea.reasoning}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
