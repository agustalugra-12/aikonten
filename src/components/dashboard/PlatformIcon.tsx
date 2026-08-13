import type { SocialAccount } from "@/types";

// Ikon platform monokrom (2026-08-13, permintaan Agus - "rapikan tampilan AI konten
// spt Buffer, warna hitam putih spt sekarang saja") - lucide-react SENGAJA tidak
// menyertakan logo brand (Instagram/TikTok/dst, lisensi trademark), jadi digambar
// manual sbg outline sederhana, `currentColor` supaya ikut warna teks sekitarnya
// (selalu abu-abu/hitam - TIDAK PERNAH warna asli brand, sesuai constraint hitam putih).
export function PlatformIcon({ platform, className }: { platform: SocialAccount["platform"]; className?: string }) {
  switch (platform) {
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-label="Instagram">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-label="Facebook">
          <path d="M14 8.5h2.5V5H14c-2.2 0-4 1.8-4 4v2H8v3.5h2V21h3.5v-6.5H16l.5-3.5h-3V9c0-.6.4-1 1-1Z" strokeLinejoin="round" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-label="YouTube">
          <rect x="2.5" y="6" width="19" height="12" rx="4" />
          <path d="M10.5 9.8v4.4l4-2.2-4-2.2Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-label="TikTok">
          <path d="M14 4v10.5a3 3 0 1 1-2.4-2.94" strokeLinecap="round" />
          <path d="M14 4c.4 2.2 2 3.8 4 4.2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
