// Kontras logo di tepi atas video (2026-11-07).
//
// MASALAH: logo brand digambar langsung di atas footage. Logo GELAP di atas footage
// GELAP nyaris hilang - terlihat nyata di video peralihan agustap (detik 8, 52, 80).
// drop-shadow yang sudah ada hanya menolong logo terang di latar terang.
//
// SOLUSI: ukur kecerahan logo SATU KALI per URL (sharp, 32x32, abaikan piksel
// transparan), lalu pilih alas yang memberi kontras: logo gelap -> alas TERANG,
// logo terang -> alas GELAP. Gagal ambil/baca -> "none" = perilaku lama persis,
// jadi tak ada regresi untuk brand mana pun.
import sharp from "sharp";

export type AlasLogo = "light" | "dark" | "none";

export type PikselMentah = { data: Buffer | Uint8Array; info: { channels: number } };

/** Luminans rata-rata (0-255) piksel NON-transparan. null kalau semua transparan. */
export function luminansRata(o: PikselMentah): number | null {
  const { data } = o;
  const ch = o.info.channels;
  let jumlah = 0, n = 0;
  for (let p = 0; p + ch - 1 < data.length; p += ch) {
    const alpha = ch >= 4 ? data[p + 3] : 255;
    if (alpha < 32) continue; // praktis transparan - jangan dihitung
    jumlah += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    n++;
  }
  return n ? jumlah / n : null;
}

/** Logo gelap (luminans < 128) butuh alas TERANG, sebaliknya alas GELAP. */
export function alasDariLuminans(lum: number | null): AlasLogo {
  if (lum === null) return "none";
  return lum < 128 ? "light" : "dark";
}

const ingatan = new Map<string, AlasLogo>(); // per URL, hemat unduhan tiap render

export async function deteksiAlasLogo(
  url: string | null | undefined,
  ambil: typeof fetch = fetch
): Promise<AlasLogo> {
  const u = (url || "").trim();
  if (!u) return "none";
  const tersimpan = ingatan.get(u);
  if (tersimpan) return tersimpan;
  let hasil: AlasLogo = "none";
  try {
    const res = await ambil(u);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const mentah = await sharp(buf).resize(32, 32, { fit: "inside" }).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      hasil = alasDariLuminans(luminansRata({ data: mentah.data, info: { channels: mentah.info.channels } }));
    }
  } catch {
    hasil = "none"; // fail-soft: tampilan lama
  }
  ingatan.set(u, hasil);
  return hasil;
}
