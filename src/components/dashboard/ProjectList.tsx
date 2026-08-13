"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/dashboard/PlatformIcon";
import { toast } from "sonner";
import type { Brand, Project, SocialAccount } from "@/types";
import { STATUS_LABEL, STATUS_VARIANT } from "@/types";

// Lewatkan pratinjau lewat domain aplikasi sendiri, bukan hotlink langsung ke r2.dev
// (sama alasan dgn DraftReview.tsx - domain r2.dev kemungkinan kena blokir jaringan di
// sisi Agus, publish sungguhan tidak lewat jalur ini sama sekali jadi tidak terdampak).
function proxiedUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// "Video Pendek/Panjang" (2026-08-13, permintaan Agus) - ambang 60 detik SAMA PERSIS
// dgn konvensi Shorts/Reels/TikTok yg sudah dipakai di seluruh kode ini (lihat
// processProject.ts isYoutubeShorts) - bukan angka baru yg diketok sendiri.
function formatBadgeLabel(project: Project): string {
  if (project.type === "carousel") return "Carousel";
  if (project.durationSeconds == null) return "Video";
  return project.durationSeconds <= 60 ? "Video Pendek" : "Video Panjang";
}

// Estimasi jam publish (2026-08-13, permintaan Agus - "detil konten akan di publis jam
// brapa"). SENGAJA dilabeli "~"/"estimasi" - logika SEBENARNYA di cron/auto-publish.ts
// py nuansa lebih (slot yg kelewat tanpa konten ready dianggap hilang PERMANEN, bukan
// di-backfill) yg TIDAK direplikasi presisi di sini, cukup indikasi kasar drpd Agus
// tidak tahu sama sekali kapan draft-nya bakal tayang.
function estimateScheduleLabel(project: Project, brand: Brand | null, allProjects: Project[]): string {
  if (project.status === "published") {
    return `Tayang ${new Date(project.updatedAt).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  if (project.status === "publishing") return "Sedang dipublikasikan...";
  if (project.status !== "ready") return "";
  if (!brand || brand.publishMode !== "auto") return "Menunggu publikasi manual";

  const slots: string[] = brand.autoPublishTimes ? JSON.parse(brand.autoPublishTimes) : [];
  if (slots.length === 0) return "Menunggu publikasi manual";

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const remainingSlots = slots
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return { t, minutes: h * 60 + m };
    })
    .filter((s) => s.minutes >= nowMinutes)
    .sort((a, b) => a.minutes - b.minutes);

  const readyQueue = allProjects
    .filter((p) => p.brandId === project.brandId && p.status === "ready" && !p.skipAutoPublish)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const position = readyQueue.findIndex((p) => p.id === project.id);
  if (position === -1) return "Menunggu publikasi manual"; // skipAutoPublish=true

  if (position >= remainingSlots.length) {
    return `~${slots[0]} besok (estimasi)`;
  }
  return `~${remainingSlots[position].t} (estimasi)`;
}

// Tampilan Buffer-style (2026-08-13, permintaan Agus - "rapikan tampilan AI konten
// sperti buffer, warna hitam putih spt sekarang saja") - list antrean per baris
// (thumbnail + format/durasi + status + jam publish + platform tujuan), gantikan
// tabel polos sebelumnya. Warna TETAP tokens shadcn abu-abu/hitam yg sudah ada (lihat
// globals.css) - TIDAK ada warna baru ditambahkan, murni layout/tipografi/komposisi.
export function ProjectList({
  projects,
  brand,
  accounts,
  onRetry,
}: {
  projects: Project[];
  brand: Brand | null;
  accounts: SocialAccount[];
  onRetry?: () => void;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);

  async function handleRetry(id: string) {
    setRetrying(id);
    try {
      const res = await fetch(`/api/projects/${id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Gagal coba ulang, coba lagi nanti");
        return;
      }
      toast.success(
        body.mode === "publish"
          ? "Konten sudah ada, coba publish ulang - cek status beberapa saat lagi"
          : "Diproses ulang dari awal - cek status beberapa saat lagi"
      );
      onRetry?.();
    } catch {
      toast.error("Gagal coba ulang, coba lagi nanti");
    } finally {
      setRetrying(null);
    }
  }

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Belum ada konten utk brand ini.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {projects.map((p) => {
        const scheduleLabel = estimateScheduleLabel(p, brand, projects);
        return (
          <div key={p.id} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
            <div className="shrink-0 w-16 h-16 rounded-md overflow-hidden bg-muted flex items-center justify-center">
              {p.previewType === "video" ? (
                <video src={proxiedUrl(p.previewUrl!)} preload="metadata" muted className="w-full h-full object-cover" />
              ) : p.previewType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={proxiedUrl(p.previewUrl!)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] text-muted-foreground text-center px-1">Belum ada aset</span>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs font-normal">
                  {formatBadgeLabel(p)}
                  {p.durationSeconds != null && p.type === "video" ? ` · ${formatDuration(p.durationSeconds)}` : ""}
                </Badge>
                <Badge variant={STATUS_VARIANT[p.status]} className="text-xs">
                  {STATUS_LABEL[p.status]}
                </Badge>
              </div>

              <p className="text-sm text-foreground/90 truncate max-w-2xl">
                {p.generatedCaption || p.script || "(belum ada caption)"}
              </p>

              {p.status === "failed" && p.errorMessage && (
                <p className="text-xs text-destructive truncate max-w-2xl" title={p.errorMessage}>
                  {p.errorMessage}
                </p>
              )}

              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                {scheduleLabel && <span>{scheduleLabel}</span>}
                {accounts.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    {accounts.map((acc) => (
                      <PlatformIcon key={acc.id} platform={acc.platform} className="w-3.5 h-3.5" />
                    ))}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0 flex flex-col items-end gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(p.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
              </span>
              {p.status === "failed" && (
                <Button size="sm" variant="outline" disabled={retrying === p.id} onClick={() => handleRetry(p.id)}>
                  {retrying === p.id ? "Memproses…" : "Coba Lagi"}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
