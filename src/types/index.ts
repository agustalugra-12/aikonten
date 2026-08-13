export type Brand = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  dailyVideoCount: number;
  dailySinglePhotoCount: number;
  dailyCarouselCount: number;
  dailyYoutubeShortsCount: number;
  videoDurationTarget: number;
  carouselPhotosPerPost: number;
  videoOrientation: "portrait" | "landscape" | "square";
  stylePreset: "energetic" | "documentary" | "minimal";
  manualKnowledge: string | null;
  knowledgeSite: string | null;
  publishMode: "draft" | "auto";
  autoPublishTimes: string | null; // JSON string[] "HH:MM" mentah dari DB, lihat schema.ts - parse dulu sebelum dipakai
  posterBrandProfile: string | null;
  createdAt: string;
};

export type ProjectStatus = "uploaded" | "processing" | "ready" | "publishing" | "published" | "failed";

export type Project = {
  id: string;
  brandId: string;
  type: "video" | "carousel";
  status: ProjectStatus;
  script: string | null;
  generatedCaption: string | null;
  generatedHashtags: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  // YouTube Editorial Engine (2026-08-10, laporan Agus - "apa judulnya tidak ada di
  // draft?") - field INI SUDAH ADA di DB/API sejak awal (route GET /api/projects/[id]
  // spread seluruh row), cuma tidak pernah dideklarasikan di type frontend jadi
  // DraftReview.tsx tidak bisa baca judulnya sama sekali (nunjukkin project.script yg
  // isinya skrip 5-8 menit PENUH, bukan judul). Cukup titles[selectedTitleIndex] yg
  // dibutuhkan di UI - typed longgar drpd duplikat seluruh shape YoutubeMetadata dari
  // lib/ai/youtubeEditorial.ts di sini.
  youtubeMetadata: string | null;
  // skipAutoPublish - SUDAH ADA di DB/API (spread seluruh row) tapi belum pernah
  // dideklarasikan di sini, sama kelas "gap" dgn youtubeMetadata di atas - dibutuhkan
  // utk estimasi jadwal publish (ProjectList.tsx) supaya draft yg SENGAJA dikecualikan
  // dari auto-publish tidak ikut dihitung isi slot.
  skipAutoPublish: boolean;
  // Preview ringkas (2026-08-13, cuma diisi GET /api/projects, BUKAN GET
  // /api/projects/[id] - lihat catatan lengkap di route.ts) - thumbnail + durasi utk
  // tampilan daftar konten, tanpa perlu fetch detail per baris.
  previewUrl?: string | null;
  previewType?: "video" | "image" | null;
  durationSeconds?: number | null;
};

export type MediaAsset = {
  id: string;
  projectId: string;
  type: "raw_footage" | "final_video" | "final_image" | "subtitle_file" | "thumbnail" | "broll_used";
  fileUrl: string;
  durationSeconds: number | null;
  createdAt: string;
};

export type ProjectDetail = Project & { assets: MediaAsset[] };

export type SocialAccount = {
  id: string;
  platform: "instagram" | "facebook" | "tiktok" | "youtube";
  publishVia: "native" | "buffer";
  username: string;
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  uploaded: "Terupload",
  processing: "Diproses AI",
  ready: "Siap Publish",
  publishing: "Mempublikasikan",
  published: "Terpublikasi",
  failed: "Gagal",
};

export const STATUS_VARIANT: Record<ProjectStatus, "default" | "secondary" | "destructive" | "outline"> = {
  uploaded: "outline",
  processing: "secondary",
  ready: "default",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
};
