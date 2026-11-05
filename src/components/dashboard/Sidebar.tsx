"use client";

import {
  LayoutDashboard,
  PenSquare,
  GalleryHorizontal,
  FolderOpen,
  Music,
  Settings,
  BarChart3,
  CalendarDays,
  Building2,
  Brain,
  Share2,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types";

export type DashboardView =
  | "overview"
  | "buat"
  | "konten"
  | "ide"
  | "rencana"
  | "kanal"
  | "kompetitor"
  | "agustap"
  | "footage"
  | "musik"
  | "laporan"
  | "pengaturan";

type NavItem = { view?: DashboardView; label: string; icon: typeof LayoutDashboard; href?: string };
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
    section: "Social Channels",
    items: [{ view: "kanal", label: "Kanal Terhubung", icon: Share2 }],
  },
  {
    section: "AI Intelligence",
    items: [
      { view: "kompetitor", label: "AI Studio & R&D", icon: Brain },
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
    items: [
      { view: "pengaturan", label: "Pengaturan Brand", icon: Settings },
      { label: "Kredit & Langganan", icon: Wallet, href: "/kredit" },
    ],
  },
];

// Agustap Studio Content Intelligence (PRD §2.18/§2.21) - item TAMBAHAN di grup AI
// Intelligence, HANYA muncul kalau brand ini Agustap Studio. Brand lain 100% sama.
const AGUSTAP_NAV_ITEM: NavItem = { view: "agustap", label: "Agustap Studio", icon: Brain };
const AGUSTAP_KNOWLEDGE_SITE = "agustap_studio";

// Sidebar gaya mockup KontenPilot (2026-09-11): wordmark + badge versi, grup nav
// berlabel, lebar 60. Warna via token shadcn yg sudah diselaraskan ke palet mockup.
// Responsive (2026-11-05): desktop = aside statis (md+); HP = drawer off-canvas yg
// dibuka dari tombol hamburger di header (prop `open`/`onClose`). Isi nav identik -
// desktop flow tidak berubah.
export function Sidebar({
  brand,
  activeView,
  onSelectView,
  open = false,
  onClose,
}: {
  brand: Brand | null;
  activeView: DashboardView;
  onSelectView: (v: DashboardView) => void;
  open?: boolean;
  onClose?: () => void;
}) {
  const isAgustap = brand?.knowledgeSite === AGUSTAP_KNOWLEDGE_SITE;
  const groups = NAV_GROUPS.map((g) =>
    g.section === "AI Intelligence" && isAgustap ? { ...g, items: [...g.items, AGUSTAP_NAV_ITEM] } : g
  );

  // Isi sidebar dipakai dua kali (aside desktop + drawer HP). `onNavigate` dipanggil
  // setelah pilih view supaya drawer HP otomatis menutup; di desktop tak diisi.
  const content = (onNavigate?: () => void) => (
    <>
      <div className="h-14 px-4 flex items-center justify-between border-b shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-heading font-bold text-sm">
            K
          </div>
          <span className="font-heading font-bold tracking-tight text-[15px]">KontenPilot</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            v2.4
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup menu"
              className="md:hidden inline-flex items-center justify-center w-9 h-9 -mr-1 rounded-lg hover:bg-sidebar-accent"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groups.map((group) => (
          <div key={group.section} className="space-y-0.5">
            <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.section}
            </p>
            {group.items.map(({ view, label, icon: Icon, href }) => (
              <button
                key={view ?? href}
                onClick={() => {
                  if (href) {
                    window.location.href = href;
                  } else if (view) {
                    onSelectView(view);
                    onNavigate?.();
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2 min-h-11 text-sm transition-colors",
                  view && activeView === view
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

      <div className="p-3 border-t space-y-2 shrink-0">
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
          onClick={() => onNavigate?.()}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 min-h-11 text-sm text-foreground/70 hover:bg-sidebar-accent hover:text-foreground transition-colors"
        >
          <Building2 className="w-[18px] h-[18px] shrink-0" />
          Agency Dashboard
        </a>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: aside statis */}
      <aside className="hidden md:flex w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground flex-col">
        {content()}
      </aside>

      {/* HP: drawer off-canvas */}
      <div
        className={cn("md:hidden fixed inset-0 z-50", open ? "" : "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          onClick={onClose}
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <aside
          role="dialog"
          aria-modal="true"
          className={cn(
            "absolute inset-y-0 left-0 w-72 max-w-[85%] bg-sidebar text-sidebar-foreground border-r flex flex-col shadow-xl transition-transform duration-200",
            open ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {content(onClose)}
        </aside>
      </div>
    </>
  );
}
