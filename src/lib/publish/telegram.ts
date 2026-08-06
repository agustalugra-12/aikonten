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
