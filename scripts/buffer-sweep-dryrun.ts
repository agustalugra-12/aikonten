// Uji READ-ONLY listRecentPosts + rekonsiliasi sweep, TANPA publish/delete/ubah status/notif/cooldown.
//   npx tsx scripts/buffer-sweep-dryrun.ts --db data/kontenpilot.db                 (semua channel ber-pending)
//   npx tsx scripts/buffer-sweep-dryrun.ts --db data/kontenpilot.db --channel <bufferChannelId>  (1 channel, tanpa pending)
// Catatan: call Buffer yang terjadi TETAP dicatat ke ledger (akuntansi budget, sengaja). Butuh token sehat.
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const dbPath = arg("--db");
if (!dbPath) { console.error("WAJIB --db <path>"); process.exit(2); }
process.env.DATABASE_PATH = dbPath; // sebelum @/db dimuat

(async () => {
  const channel = arg("--channel");
  if (channel) {
    const { db } = await import("@/db");
    const { socialAccounts } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { listRecentPosts } = await import("@/lib/publish/bufferAuth");
    const [acc] = await db.select().from(socialAccounts).where(eq(socialAccounts.bufferChannelId, channel));
    if (!acc) { console.error("channel tidak dikenal di social_accounts"); process.exit(2); }
    const posts = await listRecentPosts(channel, acc.accessToken, { brandId: acc.brandId, channelId: channel });
    console.log(JSON.stringify({ channel, count: posts.length, posts: posts.map((p) => ({ id: p.id, status: p.status, text: p.text.slice(0, 60) })) }, null, 2));
    return;
  }
  const { runPublishSweep } = await import("@/lib/publish/sweepRunner");
  const report = await runPublishSweep({ dryRun: true, ignoreFlag: true });
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error("DRY-RUN GAGAL:", e.message); process.exit(1); });
