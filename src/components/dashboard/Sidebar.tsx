"use client";

import {
  LayoutDashboard,
  PenSquare,
  GalleryHorizontal,
  Lightbulb,
  FolderOpen,
  Music,
  Settings,
  BarChart3,
  CalendarDays,
  Building2,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types";

export type DashboardView =
  | "overview"
  | "buat"
  | "konten"
  | "ide"
  | "rencana"
  | "kompetitor"
  | "agustap"
  | "footage"
  | "musik"
  | "laporan"
  | "pengaturan";

type NavItem = { view: DashboardView; label: string; icon: typeof LayoutDashboard };
type NavGroup = { section: string; items: NavItem[] };

// Nav dikelompokkan per seksi sesuai mockup KontenPilot (2026-09-11): Workspace / AI
// Intelligence / Library / Settings. Value `view` tetap sama spt sebelumnya (switch
// client-side, bukan routing baru) + "buat" (halaman Buat Konten terpadu, baru).
const NAV_GROUPS: NavGroup[] = [
  {
    section: "Workspace",
    items: [
      { view: "overview", label: "Dashboard", icon: LayoutDashboard },
      { view: "buat", label: "Buat Konten", icon: PenSquare },
      { view: "konten", label: "Konten", icon: GalleryHorizontal },
      { view: "rencana", label: "Planner", icon: CalendarDays },
      { view: "laporan", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    section: "AI Intelligence",
    items: [
      { view: "kompetitor", label: "AI Studio & R&D", icon: Brain },
      { view: "ide", label: "Ide Konten", icon: Lightbulb },
    ],
  },
  {
    section: "Library",
    items: [
      { view: "footage", label: "Footage Bank", icon: FolderOpen },
      { view: "musik", label: "Music Bank", icon: Music },
    ],
  },
  {
    section: "Settings",
    items: [{ view: "pengaturan", label: "Pengaturan Brand", icon: Settings }],
  },
];

// Agustap Studio Content Intelligence (PRD §2.18/§2.21) - item TAMBAHAN di grup AI
// Intelligence, HANYA muncul kalau brand ini Agustap Studio. Brand lain 100% sama.
const AGUSTAP_NAV_ITEM: NavItem = { view: "agustap", label: "Agustap Studio", icon: Brain };
const AGUSTAP_KNOWLEDGE_SITE = "agustap_studio";

// Sidebar gaya mockup KontenPilot (2026-09-11): wordmark + badge versi, grup nav
// berlabel, lebar 60. Warna via token shadcn yg sudah diselaraskan ke palet mockup
// (tailwind.css) - sidebar/foreground/primary. Meter "Kapasitas AI" dari mockup
// SENGAJA belum dipasang (hindari angka palsu; nanti diisi data biaya AI nyata).
export function Sidebar({
  brand,
  activeView,
  onSelectView,
}: {
  brand: Brand | null;
  activeView: DashboardView;
  onSelectView: (v: DashboardView) => void;
}) {
  const isAgustap = brand?.knowledgeSite === AGUSTAP_KNOWLEDGE_SITE;
  const groups = NAV_GROUPS.map((g) =>
    g.section === "AI Intelligence" && isAgustap ? { ...g, items: [...g.items, AGUSTAP_NAV_ITEM] } : g
  );

  return (
    <aside className="w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      {/* Header: wordmark + badge versi */}
      <div className="h-14 px-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-heading font-bold text-sm">
            K
          </div>
          <span className="font-heading font-bold tracking-tight text-[15px]">KontenPilot</span>
        </div>
        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          v2.4
        </span>
      </div>

      {/* Nav berkelompok */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groups.map((group) => (
          <div key={group.section} className="space-y-0.5">
            <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.section}
            </p>
            {group.items.map(({ view, label, icon: Icon }) => (
              <button
                key={view}
                onClick={() => onSelectView(view)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  activeView === view
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer: brand aktif + Agency Dashboard */}
      <div className="p-3 border-t space-y-2">
        {brand && (
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-muted">
            <div className="w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold shrink-0">
              {(brand.name || "?").trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground leading-none">Brand aktif</p>
              <p className="text-xs font-medium truncate leading-tight mt-0.5">{brand.name}</p>
            </div>
          </div>
        )}
        <a
          href="/agency"
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground/70 hover:bg-sidebar-accent hover:text-foreground transition-colors"
        >
          <Building2 className="w-[18px] h-[18px] shrink-0" />
          Agency Dashboard
        </a>
      </div>
    </aside>
  );
}
