export type Brand = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  dailyVideoCount: number;
  dailyCarouselCount: number;
  knowledgeSite: string | null;
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
