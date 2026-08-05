const BUFFER_API_URL = "https://api.buffer.com";

function getBufferToken(): string {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN belum diisi di .env");
  return token;
}

async function bufferGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getBufferToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(JSON.stringify(data.errors || data));
  }
  return data.data as T;
}

export type BufferChannel = { id: string; name: string; service: string };

async function getOrganizationId(): Promise<string> {
  const orgData = await bufferGraphQL<{ account: { organizations: { id: string }[] } }>(
    "query { account { organizations { id } } }"
  );
  const orgId = orgData.account.organizations[0]?.id;
  if (!orgId) throw new Error("Tidak ada organization Buffer utk akun ini");
  return orgId;
}

// Diverifikasi langsung ke API asli 2026-07-30 (Buffer REST API v1 sudah pensiun,
// deprecated - lihat catatan di buffer.ts) - query & bentuk field ini dicek lewat
// introspeksi GraphQL sungguhan, bukan cuma dokumentasi.
export async function listBufferChannels(): Promise<BufferChannel[]> {
  const orgId = await getOrganizationId();
  const chData = await bufferGraphQL<{ channels: BufferChannel[] }>(
    "query($input: ChannelsInput!) { channels(input: $input) { id name service } }",
    { input: { organizationId: orgId } }
  );
  return chData.channels;
}

export type BufferMetric = { name: string; value: number; unit: string; type: string };

// AI Learning Engine (2026-08-05, PRD modul 13, permintaan Agus - "AI membaca View/
// Like/Share/Comment... belajar konten mana yg paling disukai") - metrik PER-POST
// (beda dari getAggregatedMetrics di bawah yg per-CHANNEL). Diverifikasi live ke API
// asli SEBELUM dibangun (introspeksi `Post.metrics` field + tes nyata ke 3 post yg
// SUDAH published brand ini - hasil views 266/220/163, BUKAN nol, jadi data ASLI
// tersedia, bukan cuma skema kosong). Return null kalau post belum ada
// metrics/metricsUpdatedAt sama sekali (terlalu baru, Buffer belum sempat sync).
export async function getPostMetrics(postId: string): Promise<BufferMetric[] | null> {
  const data = await bufferGraphQL<{ post: { metricsUpdatedAt: string | null; metrics: BufferMetric[] } }>(
    "query($input: PostInput!) { post(input: $input) { metricsUpdatedAt metrics { name value unit type } } }",
    { input: { id: postId } }
  );
  if (!data.post || !data.post.metricsUpdatedAt) return null;
  return data.post.metrics;
}

// Dashboard analitik (permintaan Agus: "ambil dari Buffer saja" - bukan integrasi
// terpisah ke Meta/YouTube Analytics API, cukup 1 sumber utk akun yg tersambung lewat
// Buffer). Diverifikasi ke API asli - field & shape metrics (name/value/unit/type)
// dicek via introspeksi, bukan dugaan.
export async function getAggregatedMetrics(
  channelId: string,
  startDateTime: string,
  endDateTime: string
): Promise<BufferMetric[]> {
  const orgId = await getOrganizationId();
  const data = await bufferGraphQL<{ aggregatedPostMetrics: { metrics: BufferMetric[] } }>(
    "query($input: AggregatedPostMetricsInput!) { aggregatedPostMetrics(input: $input) { metrics { name value unit type } } }",
    { input: { organizationId: orgId, channelIds: [channelId], startDateTime, endDateTime } }
  );
  return data.aggregatedPostMetrics.metrics;
}

type BufferPostNode = { id: string; text: string; externalLink: string | null };

async function findDuplicates(channelId: string, keepPostId: string, text: string): Promise<BufferPostNode[]> {
  const orgId = await getOrganizationId();
  const data = await bufferGraphQL<{ posts: { edges: { node: BufferPostNode }[] } }>(
    "query($input: PostsInput!) { posts(input: $input, first: 10) { edges { node { id text externalLink } } } }",
    { input: { organizationId: orgId, filter: { channelIds: [channelId] } } }
  );
  return data.posts.edges.map((e) => e.node).filter((p) => p.id !== keepPostId && p.text === text);
}

async function tryDeletePost(id: string): Promise<boolean> {
  const result = await bufferGraphQL<{ deletePost: { __typename: string } }>(
    "mutation($input: DeletePostInput!) { deletePost(input: $input) { __typename } }",
    { input: { id } }
  );
  return result.deletePost.__typename === "DeletePostSuccess";
}

// Bug NYATA ditemukan 2026-07-30 (bukan dugaan): satu panggilan createPost dari
// aplikasi ini kadang menghasilkan DUA post asli di platform tujuan - dibuktikan lewat
// publish_logs aplikasi yg cuma catat 1 panggilan API, tapi 2 post nyata muncul di
// Buffer ~3 menit berbeda, teks identik. Kemungkinan besar bug idempotency di backend
// Buffer sendiri (TIDAK ADA retry logic di kode kita), jadi TIDAK BISA diperbaiki dari
// luar - TAPI dimitigasi sebisanya di sini.
//
// Poll beberapa kali selama ~3 menit (timing duplikatnya TIDAK konsisten, dari 1
// insiden nyata munculnya ~3 menit kemudian - bukan langsung). Kalau ketemu duplikat:
// coba hapus via API - TAPI Buffer MENOLAK hapus post yg statusnya sudah "sent"
// ("Account is not allowed to perform this action on post", ditemukan lewat tes nyata),
// jadi kalau delete gagal, TETAP kasih tau Agus lewat Telegram dgn link asli post-nya
// biar bisa dihapus manual di app TikTok/Instagram - JANGAN diam2 gagal.
export async function checkAndHandleDuplicate(opts: {
  channelId: string;
  keepPostId: string;
  text: string;
  brandName: string;
  platformLabel: string;
}): Promise<void> {
  const { sendTelegramNotification } = await import("./telegram");
  const pollDelaysMs = [15_000, 30_000, 45_000, 60_000, 60_000]; // total ~3.5 menit

  for (const delay of pollDelaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    const duplicates = await findDuplicates(opts.channelId, opts.keepPostId, opts.text);
    if (duplicates.length === 0) continue;

    for (const dup of duplicates) {
      let deleted = false;
      try {
        deleted = await tryDeletePost(dup.id);
      } catch {
        deleted = false;
      }

      if (deleted) {
        await sendTelegramNotification(
          `🧹 <b>${opts.brandName}</b> - duplikat post terdeteksi di ${opts.platformLabel} & berhasil dihapus otomatis (bug dari sisi Buffer, bukan aplikasi ini).`
        );
      } else {
        await sendTelegramNotification(
          `⚠️ <b>${opts.brandName}</b> - duplikat post terdeteksi di ${opts.platformLabel} tapi TIDAK BISA dihapus otomatis (sudah terlanjur tayang). Tolong hapus manual:\n${dup.externalLink || dup.id}`
        );
      }
    }
    return; // sudah ketemu & ditangani, tidak perlu lanjut poll
  }
}
