"use client";

import { LayoutDashboard, GalleryHorizontal, Lightbulb, FolderOpen, Music, Settings, BarChart3, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types";

export type DashboardView = "overview" | "konten" | "ide" | "rencana" | "footage" | "musik" | "laporan" | "pengaturan";

const NAV_ITEMS: { view: DashboardView; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "overview", label: "Dashboard", icon: LayoutDashboard },
  { view: "konten", label: "Konten", icon: GalleryHorizontal },
  { view: "ide", label: "Ide Konten", icon: Lightbulb },
  { view: "rencana", label: "Rencana Konten", icon: CalendarDays },
  { view: "footage", label: "Footage Bank", icon: FolderOpen },
  { view: "musik", label: "Music Bank", icon: Music },
  { view: "laporan", label: "Laporan", icon: BarChart3 },
  { view: "pengaturan", label: "Pengaturan Brand", icon: Settings },
];

// Sidebar navigasi (2026-08-13, permintaan Agus - konsep dashboard baru gaya app musik
// [referensi Google Drive], warna TETAP hitam-putih/grayscale tokens shadcn yg sudah
// ada, elemen struktural [sidebar+greeting+stat card+chart] diikuti, maskot ilustrasi &
// warna pastel di-drop). Switch VIEW client-side (bukan routing Next.js baru) - lebih
// aman, tidak mengubah URL yg mungkin sudah di-bookmark, konsisten dgn app ini yg dari
// awal 1 halaman + dialog, bukan multi-page.
export function Sidebar({
  brand,
  activeView,
  onSelectView,
}: {
  brand: Brand | null;
  activeView: DashboardView;
  onSelectView: (v: DashboardView) => void;
}) {
  const initial = (brand?.name || "?").trim().charAt(0).toUpperCase();

  return (
    <aside className="w-56 shrink-0 border-r bg-card flex flex-col">
      <div className="p-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center text-sm font-semibold shrink-0">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Halo,</p>
          <p className="text-sm font-medium truncate">{brand?.name || "Brand"}</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            onClick={() => onSelectView(view)}
            className={cn(
              "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              activeView === view
                ? "bg-foreground text-background font-medium"
                : "text-foreground/70 hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
