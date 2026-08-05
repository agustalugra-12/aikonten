"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  contentType: "video" | "foto" | "carousel" | null;
};

function scoreColor(score: number): string {
  if (score >= 75) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (score >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  return "bg-muted text-muted-foreground";
}

const CONTENT_TYPE_ICON: Record<"video" | "foto" | "carousel", string> = { video: "🎬", foto: "📷", carousel: "🖼️" };
const CONTENT_TYPE_LABEL: Record<"video" | "foto" | "carousel", string> = { video: "Video", foto: "Foto", carousel: "Carousel" };

// AI Content Planner (2026-08-05, permintaan Agus, PRD "AI Content Brain" modul 10 -
// "setiap pagi AI membuat 10 ide") - BEDA dari ContentIdeas.tsx (itu on-demand 3-5 ide
// baru tiap diklik, tidak tersimpan) - ini batch ide TETAP sepanjang hari (sama walau
// dashboard dibuka berkali-kali), digenerate SEKALI per hari WITA
// (dailyContentPlanner.ts), grounded ke Knowledge Base Pelangi asli.
//
// Opportunity Finder (2026-08-05) - tiap ide dapat score 0-100 + reasoning (kenapa)
// dari suggestScoredContentIdeas, diurutkan skor tertinggi dulu - sesuai PRD Agus
// ("memberi skor setiap ide berdasarkan relevansi/potensi menarik/variasi/dukungan
// keyword utama").
//
// Volume/tipe konten (2026-08-05) - jumlah & split video/foto/carousel SEKARANG diatur
// di halaman Pengaturan Brand (BrandSettingsSidebar.tsx), BUKAN di sini lagi - panel ini
// disederhanakan murni jadi "lihat & pilih ide" supaya tidak ada 2 tempat pengaturan yg
// tumpang tindih (sebelumnya sempat ada mini-panel ⚙️ di sini, dipindah krn otomasi
// makin banyak setting - durasi video, jumlah foto carousel, orientasi, dst).
export function DailyContentPlanner({
  brandId,
  onPickIdea,
}: {
  brandId: string;
  onPickIdea: (script: string, type?: "video" | "foto" | "carousel") => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [ideas, setIdeas] = useState<DailyIdea[] | null>(null);

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
    if (next && ideas === null) await loadIdeas();
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
  const total = ideas?.length ?? 0;

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
              Tetap sama sepanjang hari ini kecuali dibuat ulang.{" "}
              {total > 0 ? `${visibleIdeas.length} dari ${total} belum dikerjakan.` : ""}{" "}
              Atur jumlah & tipe di halaman Pengaturan Brand.
            </p>
            <Button variant="ghost" size="sm" onClick={handleRegenerate} disabled={regenerating || loading}>
              {regenerating ? "Membuat ulang..." : "🔄 Buat Ulang"}
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Menyusun rencana konten hari ini...</p>
          ) : !ideas || ideas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada ide - coba lagi nanti.</p>
          ) : visibleIdeas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Semua {total} ide hari ini sudah dikerjakan - klik &quot;🔄 Buat Ulang&quot; kalau mau rencana baru.
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
                        <span className="shrink-0 text-xs" title={CONTENT_TYPE_LABEL[idea.contentType]}>
                          {CONTENT_TYPE_ICON[idea.contentType]}
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
