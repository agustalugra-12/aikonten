// Adapter email transaksional (2026-11-06, billing-hardening P1.7). Provider BISA DIGANTI
// lewat env EMAIL_PROVIDER tanpa ubah kode pemanggil. Kredensial SELALU dari env, TAK PERNAH
// hardcode. Dibangun dgn fetch bawaan Node 20 (tanpa dependensi baru). Kegagalan kirim TIDAK
// boleh menggagalkan alur (pemanggil membungkus try/catch; adapter juga tak melempar).
//
// Provider:
//   "console" (DEFAULT) - tak kirim apa-apa, cuma log. Prod SAAT INI belum punya provider
//     (audit 2026-11-06: tak ada channel email pelanggan) -> default aman, nol kredensial.
//   "resend" - HTTP API (fetch). Butuh RESEND_API_KEY + EMAIL_FROM di env.
// Tambah provider lain = tambah satu cabang di sini; kontrak sendEmail tetap.
export type EmailMsg = { to: string; subject: string; text: string; html?: string };
export type EmailResult = { ok: boolean; provider: string; skipped?: boolean };

export async function sendEmail(msg: EmailMsg): Promise<EmailResult> {
  const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  try {
    if (provider === "console") {
      console.log(`[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
      return { ok: true, provider, skipped: true };
    }
    if (provider === "resend") {
      const key = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!key || !from) {
        console.error("[email:resend] RESEND_API_KEY/EMAIL_FROM belum diisi - lewati (non-fatal)");
        return { ok: false, provider, skipped: true };
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
      });
      if (!res.ok) {
        console.error(`[email:resend] gagal ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return { ok: false, provider };
      }
      return { ok: true, provider };
    }
    console.error(`[email] provider tak dikenal: ${provider} - lewati (non-fatal)`);
    return { ok: false, provider, skipped: true };
  } catch (e) {
    console.error("[email] error kirim (non-fatal):", e);
    return { ok: false, provider };
  }
}

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");
const tgl = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export function emailResetPassword(to: string, link: string, menit: number): EmailMsg {
  return {
    to,
    subject: "Atur ulang password AI Konten",
    text: `Kami menerima permintaan reset password untuk akun ini.\n\nBuka tautan berikut untuk membuat password baru (berlaku ${menit} menit, sekali pakai):\n${link}\n\nJika Anda tidak meminta ini, abaikan email ini — password Anda tidak berubah.`,
  };
}
export function emailStrukPembayaran(to: string, deskripsi: string, jumlahIdr: number): EmailMsg {
  return {
    to,
    subject: "Struk pembayaran AI Konten",
    text: `Terima kasih. Pembayaran Anda sudah kami terima.\n\n${deskripsi}\nTotal: ${rupiah(jumlahIdr)}\n\nIni bukti pembayaran Anda.`,
  };
}
export function emailAktivasiPaket(to: string, namaPaket: string, berakhir: Date): EmailMsg {
  return {
    to,
    subject: `Paket ${namaPaket} aktif`,
    text: `Paket ${namaPaket} Anda sudah aktif dan berlaku sampai ${tgl(berakhir)}.\n\nKredit sudah masuk dan Anda bisa mulai membuat konten.`,
  };
}
