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
