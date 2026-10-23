import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { newId } from "@/lib/ids";

// Audit log aksi admin (2026-10-23). Catat SIAPA (adminEmail) melakukan APA (aksi) ke SIAPA
// (targetUserId) + detail opsional. SWALLOW-error: kegagalan catat audit TIDAK boleh
// menggagalkan aksinya. Dibaca di Master via /api/master/audit-log.
export async function catatAudit(p: {
  adminEmail: string; aksi: string; targetUserId?: string | null; detail?: string;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: newId("audit"),
      adminEmail: p.adminEmail,
      aksi: p.aksi,
      targetUserId: p.targetUserId ?? null,
      detail: p.detail ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("[audit] gagal catat:", e);
  }
}
