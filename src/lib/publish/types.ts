// caption sudah termasuk hashtag di dalamnya (digabung sblm dipanggil, lihat
// orchestrate.ts) - tidak ada field hashtags terpisah krn tidak ada publisher yg
// butuh itu terpisah dari teks caption.
export type PublishInput = {
  videoUrl?: string;
  imageUrls?: string[];
  caption: string;
  accessToken: string | null;
  accountUsername: string;
  // ID akun di platform (IG Business Account ID / Page ID / dst) - per-akun dari DB,
  // BUKAN env var global (lihat schema.ts socialAccounts.platformAccountId).
  platformAccountId: string | null;
  bufferChannelId?: string | null;
  // Dipakai publishViaBuffer (buffer.ts) utk nentuin metadata per-platform yg wajib
  // diisi Buffer (mis. Instagram butuh `type: post/reel`, TikTok punya batas resolusi
  // foto) - lihat memory proyek, ditemukan lewat tes nyata bkn dugaan dari dokumentasi.
  platform?: string;
  // Dipakai publishViaBuffer utk notifikasi Telegram (deteksi duplikat, lihat
  // bufferAuth.ts) - biar pesannya jelas brand mana, bukan cuma project id.
  brandName?: string;
  // Thumbnail custom - CUMA dipakai youtube.ts (satu2nya platform yg punya slot
  // thumbnail terpisah dari videonya, lihat thumbnail.ts). Undefined kalau brand ini
  // tidak punya akun YouTube (tidak pernah di-generate, lihat process/route.ts).
  thumbnailUrl?: string;
};

export type PublishResult = {
  success: boolean;
  platformPostId?: string;
  postUrl?: string;
  error?: string;
};

export type Publisher = (input: PublishInput) => Promise<PublishResult>;
