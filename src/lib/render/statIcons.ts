import path from "path";
import type { StatIconCategory } from "@/lib/ai/statExtractor";

// Ikon Stat Card (2026-08-10, "Overlay System PRD" Category A) - PNG putih SUDAH
// di-rasterize sekali dari SVG Lucide (ISC license) - lihat statExtractor.ts utk
// daftar kategori & alasan lengkap kenapa SVG vektor (bukan color-emoji font).
//
// BUG NYATA (2026-08-11, ditemukan dari 12 video GAGAL nyata semalam lewat cron
// auto-generate - "Ditandai gagal manual" TIDAK relevan di sini, ini murni teknis) -
// __dirname SEBELUMNYA dipakai di sini, tapi build Next.js/Turbopack project ini
// (dicek LANGSUNG ke .next/server/chunks/*.js - bukan asumsi) menulis ulang
// __dirname jadi STRING LITERAL saat build, dan hasilnya SALAH CASING:
// "/ROOT/src/lib/render" (huruf besar) bukan "/root/..." - path jelas tidak pernah
// ada di disk (Linux case-sensitive), ffmpeg gagal buka file, render gagal total.
// Semua test SAYA SENDIRI lolos krn selalu dijalankan via `tsx` (unbundled, __dirname
// asli benar) - TIDAK PERNAH lewat build production sungguhan sampai cron nyata
// kena. Fix: process.cwd() (dievaluasi saat RUNTIME, bukan di-string-kan saat build)
// - dikonfirmasi systemd service WorkingDirectory=/root/kontenpilot-ai, jadi selalu
// benar apa pun cara app dijalankan (tsx maupun build production).
export function getStatIconPath(category: StatIconCategory): string {
  return path.join(process.cwd(), "src/lib/render/assets/icons", `${category}.png`);
}
