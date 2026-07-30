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
};

export type PublishResult = {
  success: boolean;
  platformPostId?: string;
  postUrl?: string;
  error?: string;
};

export type Publisher = (input: PublishInput) => Promise<PublishResult>;
