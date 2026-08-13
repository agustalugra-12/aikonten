const BUFFER_API_URL = "https://api.buffer.com";

// Token PER-BRAND (2026-08-06, permintaan Agus - brand baru "laundry in bali" punya
// akun/token Buffer SENDIRI, terpisah dari akun Buffer Pelangi Homestay yang selama ini
// jadi SATU-SATUNYA token global via env var) - SEBELUM ini seluruh app cuma bisa
// terhubung ke 1 organization Buffer sekaligus (BUFFER_ACCESS_TOKEN di .env, dipakai
// tanpa pandang bulu semua brand) - persis kelas bug yang sama dgn knowledgeSite/
// posterBrandProfile yang sudah diperbaiki hari ini (arsitektur "cuma 1 Pelangi" yang
// diam-diam jadi salah begitu brand kedua/ketiga bukan Pelangi/Harmoni ditambahkan).
// `token` param OPSIONAL di semua fungsi di bawah - kalau diisi (dari
// socialAccounts.accessToken per akun, lihat social-accounts/route.ts), pakai itu;
// kalau tidak (brand lama/akun lama blm py token sendiri), fallback ke env var global -
// brand yang SUDAH terhubung (Pelangi) tetap jalan tanpa perlu migrasi data apa pun.
function resolveBufferToken(token?: string | null): string {
  const resolved = token || process.env.BUFFER_ACCESS_TOKEN;
  if (!resolved) throw new Error("Token Buffer belum diisi (baik per-akun maupun BUFFER_ACCESS_TOKEN di .env)");
  return resolved;
}

async function bufferGraphQL<T>(query: string, variables?: Record<string, unknown>, token?: string | null): Promise<T> {
  const res = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolveBufferToken(token)}`,
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

// Cache organizationId per token (2026-08-08, permintaan Agus - "optimasi buat
// penggunaan jatah rendah agar bisa kirim banyak konten", root cause ditemukan
// via audit: rate limit 24h Buffer kena krn checkAndHandleDuplicate di bawah
// manggil getOrganizationId ULANG tiap poll, padahal organizationId 1 token TIDAK
// PERNAH berubah selama proses Node ini hidup - murni pemborosan API call yang
// tidak perlu). Cache module-level (bukan per-request) krn token per-brand yang
// SAMA dipakai berkali-kali sepanjang hari (tiap publish, tiap poll duplikat) -
// proses ini jalan sbg systemd service persisten (bukan serverless yang restart
// tiap request), jadi cache bertahan lintas publish, bukan cuma dalam 1 pemanggilan.
const orgIdCache = new Map<string, string>();

async function getOrganizationId(token?: string | null): Promise<string> {
  const cacheKey = resolveBufferToken(token);
  const cached = orgIdCache.get(cacheKey);
  if (cached) return cached;

  const orgData = await bufferGraphQL<{ account: { organizations: { id: string }[] } }>(
    "query { account { organizations { id } } }",
    undefined,
    token
  );
  const orgId = orgData.account.organizations[0]?.id;
  if (!orgId) throw new Error("Tidak ada organization Buffer utk akun ini");
  orgIdCache.set(cacheKey, orgId);
  return orgId;
}

// Diverifikasi langsung ke API asli 2026-07-30 (Buffer REST API v1 sudah pensiun,
// deprecated - lihat catatan di buffer.ts) - query & bentuk field ini dicek lewat
// introspeksi GraphQL sungguhan, bukan cuma dokumentasi.
export async function listBufferChannels(token?: string | null): Promise<BufferChannel[]> {
  const orgId = await getOrganizationId(token);
  const chData = await bufferGraphQL<{ channels: BufferChannel[] }>(
    "query($input: ChannelsInput!) { channels(input: $input) { id name service } }",
    { input: { organizationId: orgId } },
    token
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
export async function getPostMetrics(postId: string, token?: string | null): Promise<BufferMetric[] | null> {
  const data = await bufferGraphQL<{ post: { metricsUpdatedAt: string | null; metrics: BufferMetric[] } }>(
    "query($input: PostInput!) { post(input: $input) { metricsUpdatedAt metrics { name value unit type } } }",
    { input: { id: postId } },
    token
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
  endDateTime: string,
  token?: string | null
): Promise<BufferMetric[]> {
  const orgId = await getOrganizationId(token);
  const data = await bufferGraphQL<{ aggregatedPostMetrics: { metrics: BufferMetric[] } }>(
    "query($input: AggregatedPostMetricsInput!) { aggregatedPostMetrics(input: $input) { metrics { name value unit type } } }",
    { input: { organizationId: orgId, channelIds: [channelId], startDateTime, endDateTime } },
    token
  );
  return data.aggregatedPostMetrics.metrics;
}

type BufferPostNode = { id: string; text: string; externalLink: string | null };

async function findDuplicates(channelId: string, keepPostId: string, text: string, token?: string | null): Promise<BufferPostNode[]> {
  const orgId = await getOrganizationId(token);
  const data = await bufferGraphQL<{ posts: { edges: { node: BufferPostNode }[] } }>(
    "query($input: PostsInput!) { posts(input: $input, first: 10) { edges { node { id text externalLink } } } }",
    { input: { organizationId: orgId, filter: { channelIds: [channelId] } } },
    token
  );
  return data.posts.edges.map((e) => e.node).filter((p) => p.id !== keepPostId && p.text === text);
}

async function tryDeletePost(id: string, token?: string | null): Promise<boolean> {
  const result = await bufferGraphQL<{ deletePost: { __typename: string } }>(
    "mutation($input: DeletePostInput!) { deletePost(input: $input) { __typename } }",
    { input: { id } },
    token
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
//
// Dikurangi dari 5 poll ke 2 (2026-08-08, permintaan Agus - "optimasi buat penggunaan
// jatah rendah agar bisa kirim banyak konten", root cause rate-limit 24h Buffer
// ditemukan via audit langsung: fungsi ini SENDIRIAN memakai 10 API call per publish
// sukses (5 poll x 2 call/poll - getOrganizationId TIDAK di-cache dulu), sementara
// createPost aslinya cuma 1 call - 1 project 3 platform = 33 call, bukan 3. SATU-
// SATUNYA data insiden nyata yg jadi dasar mitigasi ini adalah "~3 menit kemudian",
// bukan rentang acak 0-3.5 menit - 2 titik cek (~100 detik & ~200 detik, membungkus
// titik 3 menit yg terbukti) tetap menangkap insiden yg SAMA PERSIS dgn yang pernah
// terjadi, cuma tidak lagi menyapu SELURUH jendela waktu dgn 5x percobaan. Digabung
// dgn cache getOrganizationId di atas: total jadi 2 call/publish sukses (turun 80%
// dari 10), TANPA mengurangi cakupan deteksi dari 1 bug nyata yang jadi alasan
// fitur ini dibuat.
// verifyPublishSucceeded (2026-08-13, bug NYATA ditemukan - laporan Agus "upload 2
// konten Pelangi+Laundry, cuma 1 yang masuk, tapi Telegram centang ✅ keduanya"). Root
// cause: createPost() "success" (typename PostActionSuccess) cuma berarti REQUEST-nya
// DITERIMA Buffer - publish sebenarnya diproses ASYNC di sisi Buffer, `post.status` di
// titik itu masih "sending" (BUKAN "sent"), bisa berakhir "error" belakangan TANPA
// sinyal apa pun balik ke aplikasi ini. buffer.ts SEBELUM ini cuma cek __typename,
// field `status` yg sudah diminta di mutation (`post { id status }`) tidak pernah
// dibaca sama sekali.
//
// DIBUKTIKAN LANGSUNG (query manual ke API Buffer asli, bukan dugaan): 1 post TikTok
// "laundry in bali" dari kemarin (2026-08-12 21:02) status ASLINYA "error" di Buffer
// SEKARANG, padahal publish_logs kita catat "success" & Telegram SUDAH kadung kirim ✅ -
// kegagalan itu tidak pernah diketahui sama sekali. 2 post TikTok lain hari ini (yg
// jadi laporan Agus) masih "sending" 15-17 menit setelah publish, jauh lebih lama drpd
// Instagram (biasa "sent" dlm hitungan detik) - TikTok tampak platform paling rawan.
//
// Cek 2x (~5 menit & ~15 menit total stlh publish - jadwal BEDA dari
// checkAndHandleDuplicate di atas, yg tujuannya beda & jadwalnya sudah dioptimasi ketat
// utk kasusnya sendiri, jangan disatukan). Kalau status "error" di cek manapun, LANGSUNG
// koreksi tanpa tunggu cek berikutnya. Kalau MASIH "sending" di cek TERAKHIR, tetap
// dianggap bermasalah & dikabari (bukan definitif gagal, tapi jelas tidak normal -
// prinsip yang sama dgn checkAndHandleDuplicate: "JANGAN diam2 gagal").
export async function verifyPublishSucceeded(opts: {
  postId: string;
  publishLogId: string;
  projectId: string;
  brandName: string;
  platformLabel: string;
  token?: string | null;
}): Promise<void> {
  const { sendTelegramNotification } = await import("./telegram");
  const { db } = await import("@/db");
  const { publishLogs, projects, socialAccounts } = await import("@/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const pollDelaysMs = [300_000, 600_000]; // cumulative ~5 menit & ~15 menit

  for (let i = 0; i < pollDelaysMs.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollDelaysMs[i]));

    let status: string | undefined;
    try {
      const data = await bufferGraphQL<{ post: { id: string; status: string } | null }>(
        "query($input: PostInput!) { post(input: $input) { id status } }",
        { input: { id: opts.postId } },
        opts.token
      );
      status = data.post?.status;
    } catch (err) {
      console.error("[buffer] Gagal cek status publish:", err);
      continue; // gagal cek TIDAK berarti gagal publish - coba lagi di poll berikutnya
    }

    if (status === "sent") return; // benar2 terbukti sukses, tidak perlu apa2 lagi

    const isLastCheck = i === pollDelaysMs.length - 1;
    if (status !== "error" && !isLastCheck) continue; // masih "sending", masih ada kesempatan cek lagi

    // Koreksi publish_logs + status project - dihitung ulang pakai formula PERSIS sama
    // dgn orchestrate.ts (jumlah akun terhubung brand vs jumlah yg sukses), bukan
    // ditimpa manual, supaya tidak menyimpang dari satu2nya sumber kebenaran status.
    await db
      .update(publishLogs)
      .set({
        status: "failed",
        errorMessage:
          status === "error"
            ? 'Buffer awalnya lapor sukses, tapi status asli akhirnya "error" (publish gagal di sisi Buffer, TIDAK pernah benar2 tayang).'
            : `Buffer awalnya lapor sukses, tapi status asli masih "${status}" setelah ~15 menit (tidak normal - kemungkinan macet, cek manual).`,
      })
      .where(eq(publishLogs.id, opts.publishLogId));

    const [project] = await db.select().from(projects).where(eq(projects.id, opts.projectId));
    if (project) {
      const connectedAccounts = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.connected, true)));
      const allLogs = await db.select().from(publishLogs).where(eq(publishLogs.projectId, opts.projectId));
      const succeededCount = new Set(allLogs.filter((l) => l.status === "success").map((l) => l.socialAccountId)).size;
      const correctedStatus = succeededCount === 0 ? "failed" : succeededCount === connectedAccounts.length ? "published" : "partial";
      await db.update(projects).set({ status: correctedStatus, updatedAt: new Date() }).where(eq(projects.id, opts.projectId));
    }

    await sendTelegramNotification(
      `⚠️ <b>${opts.brandName}</b> - KOREKSI: ${opts.platformLabel} SEBENARNYA ${status === "error" ? "GAGAL" : "belum pasti tayang"} ` +
        `(sebelumnya sempat dilaporkan ✅ sukses - Buffer cuma konfirmasi REQUEST diterima, bukan konfirmasi tayang). ` +
        `Status Buffer saat ini: "${status}". Project: ${opts.projectId}. Cek manual, mungkin perlu di-post ulang.`
    );
    return;
  }
}

export async function checkAndHandleDuplicate(opts: {
  channelId: string;
  keepPostId: string;
  text: string;
  brandName: string;
  platformLabel: string;
  token?: string | null;
}): Promise<void> {
  const { sendTelegramNotification } = await import("./telegram");
  const pollDelaysMs = [100_000, 100_000]; // cumulative ~100s & ~200s - membungkus titik ~3 menit dari insiden nyata

  for (const delay of pollDelaysMs) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    const duplicates = await findDuplicates(opts.channelId, opts.keepPostId, opts.text, opts.token);
    if (duplicates.length === 0) continue;

    for (const dup of duplicates) {
      let deleted = false;
      try {
        deleted = await tryDeletePost(dup.id, opts.token);
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
