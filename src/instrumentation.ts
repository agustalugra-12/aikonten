import { sendTelegramNotification } from "@/lib/publish/telegram";

// Error tracking ringan (2026-10-23) - pengganti Sentry tanpa akun/biaya. Next onRequestError
// menangkap error server (500) di route/render; kirim alert Telegram. Dedupe 30 menit per
// signature (path+pesan) biar 1 bug berulang tak membanjiri chat. Reset saat restart (cukup;
// 1 instance). SELALU swallow - error handler tak boleh melempar.
const lastSent = new Map<string, number>();
const DEDUP_MS = 30 * 60 * 1000;

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string },
): Promise<void> {
  try {
    const e = err as { message?: string; stack?: string };
    const path = request?.path || context?.routePath || "?";
    const msg = (e?.message || String(err)).slice(0, 300);
    const sig = `${path}::${msg.slice(0, 80)}`;
    const now = Date.now();
    if (now - (lastSent.get(sig) ?? 0) < DEDUP_MS) return;
    lastSent.set(sig, now);
    const stack = (e?.stack || "").split("\n").slice(1, 3).join("\n").replace(/[<>&]/g, "");
    await sendTelegramNotification(
      `\u{1F41E} <b>Error server</b> ${request?.method || ""} ${path}\n${msg}` +
      (stack ? `\n<code>${stack}</code>` : ""),
    );
  } catch {
    /* jangan lempar dari error handler */
  }
}
