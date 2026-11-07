// Caption kata-per-kata: WAKTU dari Whisper, KATA dari teks asli (2026-11-07).
//
// MASALAH: sejak TTS menerima teks hasil angkaKeKata (processProject.ts:1060), yang
// diucapkan adalah "dua ratus sembilan puluh sembilan ribu rupiah". Caption berjalan
// diambil dari transkripsi audio, jadi di layar muncul pecahan kata seperti "puluh" -
// terlihat nyata di video peralihan agustap detik 52. Penonton harus membaca "Rp299.000".
//
// SOLUSI: Whisper tetap satu-satunya sumber WAKTU (tak ada panggilan tambahan, tak ada
// biaya tambahan). Tapi teks yang ditampilkan diambil dari naskah ASLI. Caranya:
// naskah asli -> angkaKeKata -> teks ucapan. angkaKeKata hanya MENGGANTI token berangka
// dengan beberapa kata dan TIDAK PERNAH menukar urutan, jadi pemetaan token ucapan ->
// token tampil bisa dihitung pasti dengan dua penunjuk. Beberapa kata Whisper yang
// jatuh ke satu token asli digabung waktunya (start paling awal, end paling akhir).
//
// FAIL-SOFT: kalau penyelarasan jelas gagal (hasil terlalu sedikit), kembalikan kata
// Whisper apa adanya - caption tetap jalan seperti sebelumnya, tak pernah kosong.

export type KataWaktu = { word: string; start: number; end: number };

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function tokenisasi(teks: string): string[] {
  return String(teks || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

const MAKS_KATA_PER_ANGKA = 20; // "seratus dua puluh tiga ribu empat ratus..." masih jauh di bawah ini
const JENDELA_CARI = 6;         // toleransi Whisper salah dengar / sisip kata

/** peta[j] = indeks token TAMPIL untuk token UCAPAN ke-j. */
export function petakanUcapanKeTampil(tampil: string[], ucapan: string[]): number[] {
  const peta = new Array<number>(ucapan.length).fill(-1);
  let i = 0, j = 0;
  while (j < ucapan.length && i < tampil.length) {
    if (norm(tampil[i]) === norm(ucapan[j])) { peta[j] = i; i++; j++; continue; }
    if (/\d/.test(tampil[i])) {
      // Token berangka -> diganti jadi beberapa kata. Serap kata ucapan sampai bertemu
      // token tampil BERIKUTNYA (penanda akhir ganti), atau sampai batas aman.
      const penanda = i + 1 < tampil.length ? norm(tampil[i + 1]) : null;
      let diserap = 0;
      while (j < ucapan.length && diserap < MAKS_KATA_PER_ANGKA && (penanda === null || norm(ucapan[j]) !== penanda)) {
        peta[j] = i; j++; diserap++;
      }
      i++;
      continue;
    }
    // Ketidakcocokan lain (Whisper salah dengar kata biasa): jangan macet, maju berdua.
    peta[j] = i; i++; j++;
  }
  for (; j < ucapan.length; j++) peta[j] = Math.max(0, tampil.length - 1);
  return peta;
}

/** Caption akhir: kata dari `teksTampil`, waktu dari `kataWhisper`. */
export function captionDariTeksAsli(
  teksTampil: string,
  teksUcapan: string,
  kataWhisper: KataWaktu[]
): KataWaktu[] {
  const tampil = tokenisasi(teksTampil);
  const ucapan = tokenisasi(teksUcapan);
  if (!tampil.length || !ucapan.length || !kataWhisper.length) return kataWhisper;
  // Teks tidak mengandung angka sama sekali -> tak ada yang perlu dipulihkan.
  if (!/\d/.test(teksTampil)) return kataWhisper;

  const peta = petakanUcapanKeTampil(tampil, ucapan);
  const ember = new Map<number, { start: number; end: number }>();
  let u = 0;
  for (const w of kataWhisper) {
    const n = norm(w.word);
    let ketemu = -1;
    for (let k = u; k < Math.min(ucapan.length, u + JENDELA_CARI); k++) {
      if (norm(ucapan[k]) === n) { ketemu = k; break; }
    }
    const idx = ketemu >= 0 ? ketemu : Math.min(u, ucapan.length - 1);
    u = idx + 1;
    const t = peta[idx];
    if (t < 0) continue;
    const b = ember.get(t);
    if (!b) ember.set(t, { start: w.start, end: w.end });
    else { b.start = Math.min(b.start, w.start); b.end = Math.max(b.end, w.end); }
  }

  const hasil: KataWaktu[] = [];
  for (let t = 0; t < tampil.length; t++) {
    const b = ember.get(t);
    if (b) hasil.push({ word: tampil[t], start: b.start, end: b.end });
  }
  // Penyelarasan dianggap gagal kalau kehilangan lebih dari separuh kata -> pakai Whisper.
  return hasil.length >= Math.max(3, Math.floor(kataWhisper.length * 0.5)) ? hasil : kataWhisper;
}
