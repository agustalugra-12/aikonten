// Sweep verifikasi publish Buffer - I/O (DB + Buffer). Logika keputusan murni di sweep.ts.
// Flag BUFFER_SWEEP_ENABLED (default OFF):
//   OFF -> afterBufferPublish menjalankan verifikasi LAMA persis (verifyPublishSucceeded, skip Instagram) dan
//          buffer.ts tetap menjalankan cek duplikat per-post. Sweep cron = no-op.
//   ON  -> post Buffer sukses dicatat sbg pending di DB (tahan restart); sweep cron memverifikasi status +
//          duplikat dengan SATU query `posts` per channel ber-pending. Verifikasi lama TIDAK dipanggil utk
//          jalur yang sudah dicatat di sini (tak ada post tanpa verifikasi).
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { bufferPendingChecks, publishLogs, projects, socialAccounts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { listRecentPosts, tryDeletePost, verifyPublishSucceeded } from "./bufferAuth";
import { assertLedgerReady, setTokenCooldown, tokenFingerprint } from "./ledger";
import { tokenVerdict } from "./publishGate";
import { channelsToSweep, defaultSweepCfg, reconcileSweep, sweepEnabled, type SweepCfg } from "./sweep";
import { classifyBufferError, cooldownForReason, defaultCooldownCfg } from "./guard";

const VERIFY_SKIP_PLATFORMS = new Set(["instagram"]); // sama persis jalur lama orchestrate.ts

export type AfterPublishInput = {
  publishLogId: string;
  projectId: string;
  socialAccountId: string;
  brandId: string;
  brandName: string;
  platform: string;
  platformLabel: string;
  channelId: string;
  token: string | null;
  platformPostId: string;
  postText: string;
};

// Dipanggil orchestrate.ts setelah publish Buffer SUKSES. Return mode yang dipakai (utk tes/observability).
export async function afterBufferPublish(i: AfterPublishInput): Promise<"sweep_pending" | "legacy_verify" | "legacy_skip_platform"> {
  if (sweepEnabled()) {
    await db.insert(bufferPendingChecks).values({
      id: newId("bpc"),
      publishLogId: i.publishLogId,
      projectId: i.projectId,
      socialAccountId: i.socialAccountId,
      brandId: i.brandId,
      channelId: i.channelId,
      tokenFp: tokenFingerprint(i.token),
      platform: i.platform,
      platformPostId: i.platformPostId,
      postText: i.postText,
      dupHandled: false,
      createdAt: new Date(),
    });
    return "sweep_pending";
  }
  if (VERIFY_SKIP_PLATFORMS.has(i.platform)) return "legacy_skip_platform";
  verifyPublishSucceeded({
    postId: i.platformPostId,
    publishLogId: i.publishLogId,
    projectId: i.projectId,
    brandName: i.brandName,
    platformLabel: i.platformLabel,
    token: i.token,
    brandId: i.brandId,
    channelId: i.channelId,
  }).catch((err) => console.error("[orchestrate] Gagal verifikasi status publish:", err));
  return "legacy_verify";
}

// Formula status project SAMA dgn orchestrate/verifyPublishSucceeded (akun connected vs akun sukses).
async function recomputeProjectStatus(projectId: string): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return;
  const connected = await db.select().from(socialAccounts).where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.connected, true)));
  const logs = await db.select().from(publishLogs).where(eq(publishLogs.projectId, projectId));
  const ok = new Set(logs.filter((l) => l.status === "success").map((l) => l.socialAccountId)).size;
  const st = ok === 0 ? "failed" : ok === connected.length ? "published" : "partial";
  await db.update(projects).set({ status: st, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

export type SweepReport = {
  enabled: boolean;
  dryRun: boolean;
  pendingOpen: number;
  channelsSwept: number;
  bufferCalls: number;
  skippedCooldown: string[];
  skippedBudget: string[];
  confirmed: number;
  waiting: number;
  errored: number;
  stuck: number;
  duplicatesFound: number;
  duplicatesDeleted: number;
  breaker: Array<{ channelId: string; reason: string }>;
  details: Array<{ channelId: string; posts: number; result: ReturnType<typeof reconcileSweep> }>;
};

// Satu putaran sweep. dryRun=true: HANYA baca (listRecentPosts + rekonsiliasi) - tanpa delete, tanpa ubah
// publish_logs/project/pending, tanpa notifikasi, tanpa set cooldown. (Call Buffer tetap dicatat di ledger.)
export async function runPublishSweep(opts: { nowMs?: number; dryRun?: boolean; notify?: (msg: string) => Promise<void>; cfg?: SweepCfg; ignoreFlag?: boolean } = {}): Promise<SweepReport> {
  const nowMs = opts.nowMs ?? Date.now();
  const dryRun = !!opts.dryRun;
  const report: SweepReport = { enabled: sweepEnabled(), dryRun, pendingOpen: 0, channelsSwept: 0, bufferCalls: 0, skippedCooldown: [], skippedBudget: [], confirmed: 0, waiting: 0, errored: 0, stuck: 0, duplicatesFound: 0, duplicatesDeleted: 0, breaker: [], details: [] };
  if (!report.enabled && !opts.ignoreFlag) return report; // flag OFF -> no-op (verifikasi lama yang jalan)
  assertLedgerReady();
  const notify = opts.notify ?? (async (m: string) => { const { sendTelegramNotification } = await import("./telegram"); await sendTelegramNotification(m); });
  const cfg = opts.cfg ?? defaultSweepCfg(nowMs);
  const cooldownCfg = defaultCooldownCfg();

  const open = await db.select().from(bufferPendingChecks).where(isNull(bufferPendingChecks.doneAt));
  report.pendingOpen = open.length;
  if (!open.length) return report; // tak ada pending -> 0 call Buffer

  const known = new Set((await db.select({ id: publishLogs.platformPostId }).from(publishLogs).where(isNotNull(publishLogs.platformPostId))).map((r) => r.id as string));
  const trippedTokens = new Set<string>();

  for (const channelId of channelsToSweep(open)) {
    const rows = open.filter((r) => r.channelId === channelId);
    const [acc] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, rows[0].socialAccountId));
    const token = acc?.accessToken ?? null;
    const fp = tokenFingerprint(token);
    if (trippedTokens.has(fp)) { report.skippedCooldown.push(channelId); continue; }
    // Sweep menyesuaikan sisa budget token: cooldown -> lewati; budget habis -> lewati (pending tetap di DB,
    // diproses saat budget pulih). Di zona cadangan sweep TETAP jalan (verifikasi = esensial, 1 call/channel).
    const tv = await tokenVerdict(token, nowMs);
    if (tv.cooldownUntil) { report.skippedCooldown.push(channelId); continue; }
    if (!tv.allowNewPublish) { report.skippedBudget.push(channelId); continue; }

    let posts;
    try {
      report.bufferCalls++;
      posts = await listRecentPosts(channelId, token, { brandId: rows[0].brandId ?? null, channelId });
    } catch (err) {
      const reason = classifyBufferError(String((err as Error)?.message || err));
      if (reason) {
        trippedTokens.add(fp); // isolasi: hanya channel dgn token yg sama dilewati putaran ini
        report.breaker.push({ channelId, reason });
        if (!dryRun) await setTokenCooldown(token, nowMs + cooldownForReason(reason, cooldownCfg), reason, nowMs);
      }
      continue;
    }
    report.channelsSwept++;
    const pend = rows.map((r) => ({ id: r.id, platformPostId: r.platformPostId, text: r.postText, createdAtMs: new Date(r.createdAt).getTime(), dupHandled: !!r.dupHandled }));
    const res = reconcileSweep(pend, posts, known, cfg);
    report.details.push({ channelId, posts: posts.length, result: res });
    report.confirmed += res.confirmed.length; report.waiting += res.waiting.length; report.errored += res.errored.length;
    report.stuck += res.stuck.length; report.duplicatesFound += res.duplicates.length;
    if (dryRun) continue;

    const byId = new Map(rows.map((r) => [r.id, r]));
    const label = `${acc?.platform ?? "buffer"} (@${acc?.username ?? channelId})`;
    for (const d of res.duplicates) {
      const r = byId.get(d.pendingId)!;
      let deleted = false;
      try { report.bufferCalls++; deleted = await tryDeletePost(d.postId, token, { brandId: r.brandId ?? null, channelId }); } catch { deleted = false; }
      if (deleted) report.duplicatesDeleted++;
      await notify(deleted
        ? `🧹 duplikat post terdeteksi di ${label} & berhasil dihapus otomatis (sweep, bug sisi Buffer). Project: ${r.projectId}`
        : `⚠️ duplikat post terdeteksi di ${label} tapi TIDAK BISA dihapus otomatis. Hapus manual:\n${d.externalLink || d.postId}`);
      await db.update(bufferPendingChecks).set({ dupHandled: true }).where(eq(bufferPendingChecks.id, d.pendingId));
    }
    for (const id of res.confirmed) await db.update(bufferPendingChecks).set({ doneAt: new Date(nowMs), result: "sent" }).where(eq(bufferPendingChecks.id, id));
    for (const bad of [...res.errored.map((e) => ({ ...e, kind: "error" as const })), ...res.stuck.map((e) => ({ ...e, kind: "stuck" as const }))]) {
      const r = byId.get(bad.pendingId)!;
      await db.update(publishLogs).set({
        status: "failed",
        errorMessage: bad.kind === "error"
          ? 'Buffer awalnya lapor sukses, tapi status asli akhirnya "error" (publish gagal di sisi Buffer, TIDAK pernah benar2 tayang).'
          : `Buffer awalnya lapor sukses, tapi status asli masih "${bad.status}" setelah ~${Math.round(cfg.stuckMs / 60000)} menit (tidak normal - kemungkinan macet, cek manual).`,
      }).where(eq(publishLogs.id, r.publishLogId));
      await recomputeProjectStatus(r.projectId);
      await notify(`⚠️ KOREKSI: ${label} SEBENARNYA ${bad.kind === "error" ? "GAGAL" : "belum pasti tayang"} (sebelumnya dilaporkan ✅). Status Buffer: "${bad.status}". Project: ${r.projectId}. Cek manual, mungkin perlu di-post ulang.`);
      await db.update(bufferPendingChecks).set({ doneAt: new Date(nowMs), result: bad.kind }).where(eq(bufferPendingChecks.id, bad.pendingId));
    }
  }
  return report;
}
