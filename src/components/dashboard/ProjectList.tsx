"use client";

import { useMemo, useState } from "react";
import { PlatformIcon } from "@/components/dashboard/PlatformIcon";
import { toast } from "sonner";
import type { Brand, Project, ProjectStatus, SocialAccount } from "@/types";
import { STATUS_LABEL } from "@/types";

// Port PERSIS dari mockup KontenPilot (2026-09-11, permintaan Agus "port persis").
// Warna/ukuran/ikon pakai nilai langsung mockup (Material Symbols + hex surface-container
// + font-size mockup) via arbitrary Tailwind values -> SELF-CONTAINED, tidak mengubah
// token global / halaman lain. Data & handler tetap nyata (proxiedUrl/scheduleChipFor/
// retry). Yg SENGAJA tidak diikut: kolom checkbox + bulk-action bar + atribusi "oleh
// <user>" (belum ada API bulk & sistem single-admin) - lihat catatan reconciliation.

function proxiedUrl(fileUrl: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(fileUrl)}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTypeLabel(project: Project): string {
  if (project.type === "carousel") return "Carousel";
  if (project.durationSeconds == null) return "Video";
  return project.durationSeconds <= 60 ? "Video Pendek" : "Video Panjang";
}

function typeIcon(project: Project): string {
  return project.type === "carousel" ? "auto_stories" : "smart_display";
}

// Gaya pill status mengikuti mockup (Perlu Review/Terjadwal/Terbit/Draft/Gagal), dipetakan
// ke ProjectStatus NYATA. Nilai warna = token surface-container/error mockup langsung.
function statusPillClass(status: ProjectStatus): string {
  if (status === "failed") return "bg-[#ffdad6] text-[#93000a]";
  if (status === "published") return "bg-white text-[#151c27] ring-1 ring-[#dce2f3] shadow-sm";
  if (status === "ready") return "bg-[#e7eefe] text-[#151c27]";
  return "bg-[#e2e8f8] text-[#151c27]"; // uploaded/processing/publishing
}
function statusDotClass(status: ProjectStatus): string {
  if (status === "failed") return "bg-[#ba1a1a]";
  if (status === "published" || status === "ready") return "bg-black";
  return "bg-[#555f6d]";
}

type ScheduleChip = { primary: string; sublabel?: string } | null;

function scheduleChipFor(project: Project, brand: Brand | null, allProjects: Project[]): ScheduleChip {
  if (project.status === "published") {
    return {
      primary: new Date(project.updatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      sublabel: "tayang",
    };
  }
  if (project.status === "publishing") return { primary: "Memproses" };
  if (project.status !== "ready") return null;
  if (!brand || brand.publishMode !== "auto") return { primary: "Manual", sublabel: "menunggu" };
  const slots: string[] = brand.autoPublishTimes ? JSON.parse(brand.autoPublishTimes) : [];
  if (slots.length === 0) return { primary: "Manual", sublabel: "menunggu" };
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
  if (position === -1) return { primary: "Manual", sublabel: "menunggu" };
  if (position >= remainingSlots.length) return { primary: slots[0], sublabel: "besok · estimasi" };
  return { primary: remainingSlots[position].t, sublabel: "estimasi" };
}

function relativeTime(dateStr: string): string {
  const menit = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.round(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.round(jam / 24);
  if (hari === 1) return "kemarin";
  if (hari < 30) return `${hari} hari lalu`;
  return new Date(dateStr).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function parseHashtags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    return raw.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

type FilterKey = "semua" | "ready" | "published" | "diproses" | "failed";
const FILTERS: { key: FilterKey; label: string; match: (s: ProjectStatus) => boolean }[] = [
  { key: "semua", label: "Semua", match: () => true },
  { key: "ready", label: "Siap Publish", match: (s) => s === "ready" },
  { key: "published", label: "Terbit", match: (s) => s === "published" },
  { key: "diproses", label: "Diproses", match: (s) => s === "uploaded" || s === "processing" || s === "publishing" },
  { key: "failed", label: "Gagal", match: (s) => s === "failed" },
];

export function ProjectList({
  projects,
  brand,
  accounts,
  onRetry,
  embedded = false,
}: {
  projects: Project[];
  brand: Brand | null;
  accounts: SocialAccount[];
  onRetry?: () => void;
  embedded?: boolean;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("semua");

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { semua: 0, ready: 0, published: 0, diproses: 0, failed: 0 };
    for (const p of projects) for (const f of FILTERS) if (f.match(p.status)) c[f.key] += 1;
    return c;
  }, [projects]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    return projects.filter((p) => f.match(p.status));
  }, [projects, filter]);

  async function handleRetry(id: string) {
    setRetrying(id);
    try {
      const res = await fetch(`/api/projects/${id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Gagal coba ulang, coba lagi nanti");
        return;
      }
      toast.success(body.mode === "publish" ? "Coba publish ulang - cek status sebentar lagi" : "Diproses ulang - cek status sebentar lagi");
      onRetry?.();
    } catch {
      toast.error("Gagal coba ulang, coba lagi nanti");
    } finally {
      setRetrying(null);
    }
  }

  if (projects.length === 0) {
    return <p className="text-[13px] text-[#555f6d] py-8 text-center">Belum ada konten utk brand ini.</p>;
  }

  return (
    <div className={embedded ? "" : "rounded-xl bg-white shadow-sm overflow-hidden ring-1 ring-[#e7eefe]"}>
      {/* Header + filter tabs (gaya mockup) */}
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-[#e7eefe]">
          <div>
            <h2 className="font-heading font-semibold text-[15px] text-[#151c27]">Konten</h2>
            <p className="text-[11px] text-[#555f6d] mt-0.5">
              {projects.length} konten{brand ? ` · ${brand.name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#f0f3ff] overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={
                  "px-3 py-1 rounded-md text-[12px] font-medium whitespace-nowrap transition-colors " +
                  (filter === f.key ? "bg-black text-white shadow-sm" : "text-[#555f6d] hover:text-[#151c27]")
                }
              >
                {f.label}
                <span className="ml-1.5 tabular-nums opacity-70">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[860px]">
          <thead>
            <tr className="bg-[#f0f3ff] text-[#555f6d] text-[11px] uppercase tracking-wider">
              <th className="py-2.5 px-4 font-medium">Konten</th>
              <th className="py-2.5 px-3 font-medium">Tipe</th>
              <th className="py-2.5 px-3 font-medium">Kanal</th>
              <th className="py-2.5 px-3 font-medium">Status</th>
              <th className="py-2.5 px-3 font-medium">Jadwal</th>
              <th className="py-2.5 px-3 font-medium">Diperbarui</th>
              <th className="py-2.5 px-4 font-medium text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[13px] text-[#555f6d]">
                  Tidak ada konten pada filter ini.
                </td>
              </tr>
            )}
            {visible.map((p) => {
              const chip = scheduleChipFor(p, brand, projects);
              const tags = parseHashtags(p.generatedHashtags);
              const shortId = p.id.slice(-6).toUpperCase();
              return (
                <tr key={p.id} className="border-t border-[#e7eefe] hover:bg-[#f0f3ff]/60 transition-colors align-middle">
                  {/* Konten */}
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-[#e7eefe] flex items-center justify-center shrink-0 shadow-sm">
                        {p.previewType === "video" ? (
                          <video src={proxiedUrl(p.previewUrl!)} preload="metadata" muted className="w-full h-full object-cover" />
                        ) : p.previewType === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={proxiedUrl(p.previewUrl!)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="material-symbols-outlined text-[24px] text-[#76777d]">movie_edit</span>
                        )}
                        {p.type === "video" && p.durationSeconds != null && (
                          <span className="absolute bottom-1 right-1 px-1 rounded bg-[#2a313d]/80 text-[#ebf1ff] text-[10px] tabular-nums">
                            {formatDuration(p.durationSeconds)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] text-[#555f6d]">#{shortId}</span>
                        <p className="text-[13px] font-medium text-[#151c27] truncate max-w-md mt-0.5">
                          {p.generatedCaption || p.script || "(belum ada caption)"}
                        </p>
                        {tags.length > 0 && (
                          <p className="text-[12px] text-[#555f6d] truncate max-w-md mt-0.5">
                            {tags.slice(0, 4).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Tipe */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5 text-[#151c27]">
                      <span className="material-symbols-outlined text-[16px] text-[#555f6d]">{typeIcon(p)}</span>
                      <span className="text-[13px] whitespace-nowrap">{formatTypeLabel(p)}</span>
                    </div>
                  </td>

                  {/* Kanal */}
                  <td className="py-2.5 px-3">
                    {accounts.length > 0 ? (
                      <div className="flex items-center gap-1">
                        {accounts.slice(0, 4).map((acc) => (
                          <span key={acc.id} title={acc.username} className="w-6 h-6 rounded-full bg-[#e7eefe] flex items-center justify-center">
                            <PlatformIcon platform={acc.platform} className="w-3.5 h-3.5 text-[#151c27]" />
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[12px] text-[#555f6d]">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3">
                    <span className={"inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap " + statusPillClass(p.status)}>
                      <span className={"w-1.5 h-1.5 rounded-full inline-block " + statusDotClass(p.status)} />
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>

                  {/* Jadwal */}
                  <td className="py-2.5 px-3">
                    {chip ? (
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium text-[#151c27] flex items-center gap-1 tabular-nums">
                          <span className="material-symbols-outlined text-[14px] text-[#555f6d]">calendar_today</span>
                          {chip.primary}
                        </span>
                        {chip.sublabel && <span className="font-mono text-[11px] text-[#555f6d] mt-0.5">{chip.sublabel}</span>}
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#555f6d] italic">Belum diatur</span>
                    )}
                  </td>

                  {/* Diperbarui */}
                  <td className="py-2.5 px-3">
                    <span className="text-[13px] text-[#151c27]">{relativeTime(p.updatedAt)}</span>
                  </td>

                  {/* Aksi */}
                  <td className="py-2.5 px-4 text-right">
                    {p.status === "failed" ? (
                      <button
                        type="button"
                        disabled={retrying === p.id}
                        onClick={() => handleRetry(p.id)}
                        className="px-2 py-1 rounded bg-[#ffdad6] text-[#93000a] hover:bg-[#ba1a1a] hover:text-white text-[11px] font-medium transition-colors disabled:opacity-60"
                      >
                        {retrying === p.id ? "Memproses…" : "Coba Lagi"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-[#555f6d]">—</span>
                    )}
                    {p.status === "failed" && p.errorMessage && (
                      <p className="text-[10px] text-[#ba1a1a] truncate max-w-[160px] ml-auto mt-1" title={p.errorMessage}>
                        {p.errorMessage}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
