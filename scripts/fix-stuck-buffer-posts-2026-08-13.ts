// One-off correction (2026-08-13) - 3 publish_logs record nyata yang salah tercatat
// "success" padahal status asli di Buffer TIDAK pernah benar-benar "sent" (1 "error"
// dari kemarin, 2 "sending" macet hari ini > normal) - lihat verifyPublishSucceeded di
// bufferAuth.ts utk root cause lengkap & fix strukturalnya utk publish BARU ke depan.
// Script ini HANYA membereskan 3 record yang SUDAH kadung salah SEBELUM fix itu ada.
import { db } from "@/db";
import { publishLogs, projects, socialAccounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendTelegramNotification } from "@/lib/publish/telegram";

const TARGETS = [
  { logId: "pub_8sOK--o2jloO", postId: "6a7c7cdea90610805b9aa8de", status: "error" as const },
  { logId: "pub_c4cePUUL386b", postId: "6a7d75f5e38c09c27e1f5d65", status: "sending" as const },
  { logId: "pub_Oh5zQrcKw-UB", postId: "6a7d79a7e38c09c27e1f969e", status: "sending" as const },
];

async function main() {
  for (const t of TARGETS) {
    const [log] = await db.select().from(publishLogs).where(eq(publishLogs.id, t.logId));
    if (!log) {
      console.log(`SKIP ${t.logId} - tidak ketemu`);
      continue;
    }
    const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, log.socialAccountId));
    const [project] = await db.select().from(projects).where(eq(projects.id, log.projectId));
    if (!account || !project) {
      console.log(`SKIP ${t.logId} - account/project tidak ketemu`);
      continue;
    }

    await db
      .update(publishLogs)
      .set({
        status: "failed",
        errorMessage:
          t.status === "error"
            ? 'Buffer awalnya lapor sukses, tapi status asli akhirnya "error" (publish gagal di sisi Buffer, TIDAK pernah benar2 tayang). Ditemukan & dikoreksi manual 2026-08-13.'
            : `Buffer awalnya lapor sukses, tapi status asli masih "sending" jauh lebih lama dari normal (dicek manual 2026-08-13, kemungkinan macet permanen).`,
      })
      .where(eq(publishLogs.id, t.logId));

    const connectedAccounts = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.connected, true)));
    const allLogs = await db.select().from(publishLogs).where(eq(publishLogs.projectId, project.id));
    const succeededCount = new Set(allLogs.filter((l) => l.status === "success").map((l) => l.socialAccountId)).size;
    const correctedStatus =
      succeededCount === 0 ? "failed" : succeededCount === connectedAccounts.length ? "published" : "partial";
    await db.update(projects).set({ status: correctedStatus, updatedAt: new Date() }).where(eq(projects.id, project.id));

    console.log(`KOREKSI ${t.logId} (project ${project.id}) -> publish_logs=failed, project=${correctedStatus}`);
  }

  await sendTelegramNotification(
    `⚠️ <b>Koreksi retroaktif - laundry in bali</b>\n\n` +
      `Ditemukan 3 post TikTok yang sebelumnya dilaporkan ✅ sukses, tapi status asli di Buffer TIDAK pernah benar2 "sent":\n` +
      `• Kemarin (2026-08-12 21:02) - status Buffer: "error" (gagal total, tidak pernah tayang)\n` +
      `• Hari ini (2026-08-13 ~14:45) - status Buffer: "sending" macet\n` +
      `• Hari ini (2026-08-13 ~15:00) - status Buffer: "sending" macet\n\n` +
      `Root cause: createPost() Buffer "sukses" cuma berarti REQUEST diterima, bukan konfirmasi tayang - sudah diperbaiki ` +
      `(publish baru ke depan otomatis diverifikasi ulang ~5-15 menit kemudian, dikoreksi otomatis kalau ternyata gagal). ` +
      `3 post di atas project-nya sudah ditandai benar di sistem - kontennya sendiri mungkin perlu di-post ulang manual, cek TikTok Laundry in Bali langsung.`
  );
  console.log("Notifikasi Telegram terkirim.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
