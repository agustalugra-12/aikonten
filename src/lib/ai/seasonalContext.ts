// Seasonal Content Engine (2026-08-05, PRD "AI Content Brain" modul 12, permintaan
// Agus) - "AI tahu musim hujan, libur sekolah, Natal, Nyepi, Lebaran, weekend -> konten
// berubah." Di sini KHUSUS fakta kalender yg BISA DIPASTIKAN BENAR tanpa nebak
// (weekday/weekend, hari libur nasional TANGGAL TETAP) - SENGAJA TIDAK menyertakan
// musim hujan/kemarin (butuh data cuaca live, belum ada integrasi) MAUPUN hari libur
// yg TANGGALNYA BERUBAH tiap tahun (Nyepi/Lebaran/libur sekolah - perlu kalender
// terverifikasi per tahun, bukan ditebak dari training data) - sama disiplin dgn
// BEDUGUL_FACTS/LANDMARK_FACTS di web-pelangi (fakta HARUS bersumber, bukan karangan
// model, walau itu berarti sebagian modul PRD ini belum lengkap).
const FIXED_HOLIDAYS: Record<string, string> = {
  "01-01": "Tahun Baru Masehi",
  "05-01": "Hari Buruh Internasional",
  "08-17": "Hari Kemerdekaan RI",
  "12-25": "Hari Natal",
  "12-31": "Malam Tahun Baru",
};

const DAY_NAMES_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function buildSeasonalContext(): string {
  const now = new Date();
  const wita = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Makassar" }));
  const dayName = DAY_NAMES_ID[wita.getDay()];
  const isWeekend = wita.getDay() === 0 || wita.getDay() === 6;
  const monthDay = `${String(wita.getMonth() + 1).padStart(2, "0")}-${String(wita.getDate()).padStart(2, "0")}`;
  const holidayToday = FIXED_HOLIDAYS[monthDay];

  // Besok libur/weekend? (relevan utk konten "persiapan sebelum long weekend")
  const tomorrow = new Date(wita);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowMonthDay = `${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const tomorrowIsWeekendOrHoliday = tomorrow.getDay() === 0 || tomorrow.getDay() === 6 || !!FIXED_HOLIDAYS[tomorrowMonthDay];

  const lines = [
    `Hari ini: ${dayName}${isWeekend ? " (WEEKEND)" : ""}`,
  ];
  // Kata2 GENERIK (2026-08-10, bug nyata ditemukan - versi lama "relevan utk konten
  // bertema liburan/promo"/"persiapan liburan akhir pekan (booking, packing, dst)"
  // HARDCODE kosakata travel/hospitality, disuntik ke SEMUA brand tanpa pandang bulu -
  // sama root cause dgn bug pilar/restriction/keyword yg sudah diperbaiki di
  // researchTopics.ts, fungsi ini KELEWATAN di fix itu krn dipanggil generik tanpa
  // parameter brand. Dibuktikan nyata: batch ide Animal Story & Co [channel fakta
  // hewan] penuh ide "persiapan liburan"/"booking" gara2 baris ini).
  if (holidayToday) lines.push(`Hari libur nasional hari ini: ${holidayToday} - relevan kalau brand ini py momen/konten musiman yg sesuai.`);
  if (!isWeekend && tomorrowIsWeekendOrHoliday) {
    lines.push("Besok weekend/libur - relevan kalau brand ini py konten yg cocok utk momen itu (SESUAI niche brand, bukan dipaksakan).");
  }
  return `\n\n# KONTEKS KALENDER (fakta pasti, bukan cuaca/perkiraan)\n${lines.join("\n")}`;
}
