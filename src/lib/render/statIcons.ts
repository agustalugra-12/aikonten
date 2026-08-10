import path from "path";
import type { StatIconCategory } from "@/lib/ai/statExtractor";

// Ikon Stat Card (2026-08-10, "Overlay System PRD" Category A) - PNG putih SUDAH
// di-rasterize sekali dari SVG Lucide (ISC license) - lihat statExtractor.ts utk
// daftar kategori & alasan lengkap kenapa SVG vektor (bukan color-emoji font).
export function getStatIconPath(category: StatIconCategory): string {
  return path.join(__dirname, "assets", "icons", `${category}.png`);
}
