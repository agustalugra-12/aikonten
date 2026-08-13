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

type ScheduleChip = { primary: string; sublabel?: string } | null;

// Estimasi jam publish (2026-08-13, permintaan Agus - "detil konten akan di publis jam
// brapa"). SENGAJA dilabeli "estimasi" - logika SEBENARNYA di cron/auto-publish.ts py
// nuansa lebih (slot yg kelewat tanpa konten ready dianggap hilang PERMANEN, bukan
// di-backfill) yg TIDAK direplikasi presisi di sini, cukup indikasi kasar drpd Agus
// tidak tahu sama sekali kapan draft-nya bakal tayang.
function scheduleChipFor(project: Project, brand: Brand | null, allProjects: Project[]): ScheduleChip {
  if (project.status === "published") {
    return {
      primary: new Date(project.updatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      sublabel: "tayang",
    };
  }
  if (project.status === "publishing") return { primary: "Memproses" };
  if (project.status !== "ready") return null;
  if (!brand || brand.publishMode !== "auto") return { primary: "Manual", sublabel: "menunggu publikasi" };

  const slots: string[] = brand.autoPublishTimes ? JSON.parse(brand.autoPublishTimes) : [];
  if (slots.length === 0) return { primary: "Manual", sublabel: "menunggu publikasi" };

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
  if (position === -1) return { primary: "Manual", sublabel: "menunggu publikasi" };

  if (position >= remainingSlots.length) {
    return { primary: slots[0], sublabel: "besok · estimasi" };
  }
  return { primary: remainingSlots[position].t, sublabel: "estimasi" };
}

// Pengelompokan per tanggal (2026-08-13) - "Hari Ini"/"Kemarin"/tanggal lengkap, gaya
// Buffer Queue yg dibagi per hari drpd 1 daftar rata tanpa jeda visual.
function dayGroupLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Hari Ini";
  if (sameDay(d, yesterday)) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long" });
}

function groupByDay(projects: Project[]): Array<{ label: string; items: Project[] }> {
  const groups: Array<{ label: string; items: Project[] }> = [];
  for (const p of projects) {
    const label = dayGroupLabel(p.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(p);
    else groups.push({ label, items: [p] });
  }
  return groups;
}

// Tampilan Buffer-style (2026-08-13, permintaan Agus - "rapikan tampilan AI konten
// sperti buffer, warna hitam putih spt sekarang saja, aku mau mirip"). Elemen ciri
// khas Buffer yg ditiru: kartu terpisah (bukan baris bergaris tipis), thumbnail besar
// dgn badge ikon platform NEMPEL di pojok kanan-bawah thumbnail (bukan baris ikon
// terpisah), chip jam publish yg menonjol, dikelompokkan per tanggal. Warna TETAP
// tokens shadcn abu-abu/hitam yg sudah ada (lihat globals.css) - TIDAK ada warna baru.
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

  const groups = groupByDay(projects);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
          <div className="space-y-3">
            {group.items.map((p) => {
              const chip = scheduleChipFor(p, brand, projects);
              return (
                <div
                  key={p.id}
                  className="flex items-start gap-4 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="relative shrink-0">
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted flex items-center justify-center ring-1 ring-border">
                      {p.previewType === "video" ? (
                        <video src={proxiedUrl(p.previewUrl!)} preload="metadata" muted className="w-full h-full object-cover" />
                      ) : p.previewType === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={proxiedUrl(p.previewUrl!)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground text-center px-1">Belum ada aset</span>
                      )}
                    </div>
                    {/* Badge platform nempel di pojok thumbnail - ciri khas Buffer, ganti
                        dari baris ikon terpisah di versi sebelumnya. */}
                    {accounts.length > 0 && (
                      <div className="absolute -bottom-1.5 -right-1.5 flex">
                        {accounts.slice(0, 3).map((acc, i) => (
                          <span
                            key={acc.id}
                            style={{ marginLeft: i === 0 ? 0 : -8, zIndex: accounts.length - i }}
                            className="w-6 h-6 rounded-full bg-background border-2 border-card ring-1 ring-border flex items-center justify-center"
                          >
                            <PlatformIcon platform={acc.platform} className="w-3.5 h-3.5 text-foreground" />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs font-normal">
                          {formatBadgeLabel(p)}
                          {p.durationSeconds != null && p.type === "video" ? ` · ${formatDuration(p.durationSeconds)}` : ""}
                        </Badge>
                        <Badge variant={STATUS_VARIANT[p.status]} className="text-xs">
                          {STATUS_LABEL[p.status]}
                        </Badge>
                      </div>
                      {chip && (
                        <div className="shrink-0 text-right rounded-lg bg-secondary px-2.5 py-1">
                          <p className="text-sm font-semibold leading-tight tabular-nums">{chip.primary}</p>
                          {chip.sublabel && <p className="text-[10px] text-muted-foreground leading-tight">{chip.sublabel}</p>}
                        </div>
                      )}
                    </div>

                    <p className="text-sm text-foreground/90 line-clamp-2">
                      {p.generatedCaption || p.script || "(belum ada caption)"}
                    </p>

                    {p.status === "failed" && p.errorMessage && (
                      <p className="text-xs text-destructive truncate" title={p.errorMessage}>
                        {p.errorMessage}
                      </p>
                    )}

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
        </div>
      ))}
    </div>
  );
}
