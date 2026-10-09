// Notifikasi Telegram (BUKAN WhatsApp - lihat PRD diskusi: nomor WA Pelangi/Harmoni
// sudah dipakai bot tamu, tool pribadi ini sengaja dipisah total). Dikirim tiap kali ada
// percobaan publish (berhasil ATAU gagal) krn tidak ada jeda approval manual sama sekali
// (full-auto sesuai keputusan Agus) - ini satu-satunya jaring pengaman utk tahu cepat
// kalau ada yang meleset.
export async function sendTelegramNotification(message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID belum diisi, notifikasi dilewati");
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[telegram] gagal kirim notifikasi: ${res.status} ${body}`);
  }
}

export function formatPublishNotification(params: {
  brandName: string;
  projectId: string;
  platform: string;
  success: boolean;
  postUrl?: string;
  error?: string;
}): string {
  const { brandName, projectId, platform, success, postUrl, error } = params;
  if (success) {
    return (
      `✅ <b>${brandName}</b> - konten berhasil dipublikasikan ke ${platform}\n` +
      `Project: ${projectId}\n` +
      (postUrl ? `Link: ${postUrl}` : "")
    );
  }
  return (
    `❌ <b>${brandName}</b> - GAGAL publikasi ke ${platform}\n` +
    `Project: ${projectId}\n` +
    `Error: ${error || "tidak diketahui"}`
  );
}

// Ringkasan 1 notifikasi utk SEMUA platform (2026-08-06, permintaan Agus - "report ai
// marketing cukup sekali saja jangan ketiganya" - SEBELUM ini publishProject kirim 1
// notif Telegram TERPISAH per akun sosmed di dalam loop, jadi publish ke 3 platform
// sekaligus (mis. TikTok+Instagram+Facebook) = 3 notif beruntun. Sekarang hasil semua
// akun dikumpulkan dulu, dikirim SEBAGAI 1 pesan ringkasan setelah loop selesai.
export function formatPublishSummaryNotification(params: {
  brandName: string;
  projectId: string;
  results: Array<{ platform: string; success: boolean; postUrl?: string; error?: string }>;
}): string {
  const { brandName, projectId, results } = params;
  const allSuccess = results.every((r) => r.success);
  const anySuccess = results.some((r) => r.success);
  const headerIcon = allSuccess ? "✅" : anySuccess ? "⚠️" : "❌";
  const lines = results.map((r) => {
    if (r.success) return `✅ ${r.platform}${r.postUrl ? ` - ${r.postUrl}` : ""}`;
    return `❌ ${r.platform} - ${r.error || "tidak diketahui"}`;
  });
  return (
    `${headerIcon} <b>${brandName}</b> - hasil publikasi (${results.filter((r) => r.success).length}/${results.length} berhasil)\n` +
    `Project: ${projectId}\n\n` +
    lines.join("\n")
  );
}


// Alert KREDIT HABIS (2026-10-09, permintaan Agus - Fase 5 QA menemukan 82% kegagalan
// generate = kredit Gemini/OpenAI depleted, gagal diam-diam). API provider tak expose
// saldo prepaid andal, jadi deteksi dari ERROR saat terjadi + notif Telegram SEKALI
// (dedupe in-memory 30 menit; 1 instance service, reset saat restart - cukup).
// ponytail: dedupe in-memory, pindah ke DB kalau nanti multi-instance.
const CREDIT_DEPLETION_RE = /prepayment credits are depleted|no credits remaining|insufficient_quota|"code"\s*:\s*402|429 You have no credits/i;
let lastCreditAlertAt = 0;
export async function alertCreditDepletionIfRelevant(context: string, errorMessage: string | null | undefined): Promise<void> {
  if (!errorMessage || !CREDIT_DEPLETION_RE.test(errorMessage)) return;
  const now = Date.now();
  if (now - lastCreditAlertAt < 30 * 60 * 1000) return; // sudah dialert <30 menit lalu
  lastCreditAlertAt = now;
  const provider = /openai|insufficient_quota|platform\.openai/i.test(errorMessage) ? "OpenAI" : "Gemini / AI Studio";
  try {
    await sendTelegramNotification(
      `\u{1F6A8} KREDIT ${provider} HABIS \u2014 generate konten GAGAL.\n\n` +
      `Konteks: ${context}\n` +
      `Error: ${errorMessage.slice(0, 200)}\n\n` +
      `Segera top-up kredit; semua generate akan terus gagal sampai diisi.`
    );
  } catch (e) {
    console.error("[alert] gagal kirim notif kredit habis:", e);
  }
}
