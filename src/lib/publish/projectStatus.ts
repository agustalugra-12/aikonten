// Satu-satunya formula status publish sebuah project (2026-11-07, fix "gagal diam-diam").
//
// MASALAH NYATA: 31 dari 55 project "failed" dlm 7 hari terakhir punya projects.error_message
// NULL - pemilik/pelanggan tak tahu kenapa. Penyebabnya BUKAN render: project2 itu punya 8-76
// baris publish_logs yg SEMUANYA failed ("Access token is not valid" / "Too many requests from
// this client" dari Buffer). Alasannya ADA, cuma tersimpan di publish_logs dan tidak pernah
// diangkat ke projects.error_message, krn formula status di-COPY di 3 tempat dan 2 di antaranya
// (sweepRunner.recomputeProjectStatus + bufferAuth verifyPublishSucceeded) cuma menulis
// { status } tanpa errorMessage.
//
// Fungsi ini murni (tanpa DB) supaya bisa diuji tanpa ffmpeg/Buffer/DB.

export type PublishLogLike = {
  socialAccountId: string;
  status: string;
  errorMessage?: string | null;
};

export type ProjectPublishOutcome = {
  status: "published" | "partial" | "failed";
  /** null HANYA kalau published penuh (sekalian membersihkan error lama yg sudah tak relevan). */
  errorMessage: string | null;
};

/**
 * Hitung status project + alasannya dari SEMUA publish_logs-nya (lama + baru).
 * `connectedCount` = jumlah akun sosmed brand yg connected (target publish).
 */
export function summarizeProjectPublish(
  logs: PublishLogLike[],
  connectedCount: number
): ProjectPublishOutcome {
  const ok = new Set(logs.filter((l) => l.status === "success").map((l) => l.socialAccountId)).size;
  // `>=` bukan `===` (2026-11-07): kalau salah satu akun di-disconnect SETELAH publish sukses,
  // ok bisa melebihi connectedCount - dgn `===` project nyangkut "partial" selamanya & diretry
  // cron tanpa guna.
  const status = ok === 0 ? "failed" : connectedCount > 0 && ok >= connectedCount ? "published" : "partial";
  if (status === "published") return { status, errorMessage: null };

  const reasons = [
    ...new Set(
      logs
        .filter((l) => l.status !== "success" && l.errorMessage)
        .map((l) => String(l.errorMessage).slice(0, 120))
    ),
  ].slice(0, 3);
  // Tanpa alasan tercatat pun TETAP ditulis sesuatu - "failed" dgn pesan kosong adalah bug yg
  // sedang diperbaiki di sini, jangan diulang.
  const detail = reasons.length ? ` — ${reasons.join(" | ")}` : " — tidak ada alasan tercatat di publish_logs";
  return { status, errorMessage: `Publish ${status}: ${ok}/${connectedCount} akun sukses${detail}` };
}
