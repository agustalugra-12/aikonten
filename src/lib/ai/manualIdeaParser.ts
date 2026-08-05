import ExcelJS from "exceljs";

// Parser Bank Ide Manual (2026-08-06, permintaan Agus - "menambahkan ide konten secara
// manual dsini dalam bentuk excel maupun pdf"). Excel pakai exceljs (BUKAN xlsx/SheetJS -
// xlsx punya 2 kerentanan keamanan TANPA PERBAIKAN yg tersedia [prototype pollution +
// ReDoS, dicek npm audit sblm dipilih] - riskan krn fitur ini parsing file yg diupload
// user, exceljs tidak py masalah yg sama). PDF pakai pdf-parse (lib-only, tidak py
// alternatif yg jelas lebih aman, tapi cakupan risiko lebih kecil - PDF cuma diekstrak
// teksnya, bukan dieksekusi/di-render).
//
// Format sederhana disengaja (2026-08-06) - SATU ide per baris (Excel: kolom A tiap
// baris; PDF: tiap baris teks non-kosong) - TIDAK ada parsing kolom/struktur kompleks,
// supaya Agus bisa siapkan file dari mana saja (spreadsheet sendiri, catatan HP, dll)
// tanpa perlu format kaku. Baris yg kelewat pendek (<10 karakter, kemungkinan besar
// header/nomor urut/kosong) DIBUANG otomatis.
const MIN_IDEA_LENGTH = 10;

function isLikelyIdea(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= MIN_IDEA_LENGTH;
}

export async function parseExcelIdeas(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const ideas: string[] = [];
  sheet.eachRow((row) => {
    // Ambil sel PERTAMA yg ada isinya di baris ini (kolom A biasanya, tapi jaga-jaga
    // kalau Agus geser ke kolom lain) - 1 ide per baris, bukan gabung semua kolom.
    const cells = row.values as (string | number | { text?: string; richText?: Array<{ text: string }> } | null | undefined)[];
    for (const cell of cells) {
      if (cell === null || cell === undefined) continue;
      let text = "";
      if (typeof cell === "string") text = cell;
      else if (typeof cell === "number") text = String(cell);
      else if (typeof cell === "object" && "text" in cell && cell.text) text = cell.text;
      else if (typeof cell === "object" && "richText" in cell && cell.richText) {
        text = cell.richText.map((r) => r.text).join("");
      }
      if (isLikelyIdea(text)) {
        ideas.push(text.trim());
        break; // 1 ide per baris - berhenti di sel pertama yg valid
      }
    }
  });
  return ideas;
}

export async function parsePdfIdeas(buffer: Buffer): Promise<string[]> {
  // pdf-parse v2 (2026-08-06, dicek langsung ke type declarations sblm dipakai - versi
  // terpasang JAUH beda dari API v1 klasik yg banyak dicontohkan di tutorial lama:
  // sekarang class PDFParse, bukan fungsi default export) - new PDFParse({data}).getText()
  // -> TextResult.text (semua halaman digabung).
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    // pageJoiner="" (2026-08-06, bug nyata ditemukan lewat tes live) - default lib ini
    // menyisipkan boilerplate "-- page_number of total_number --" di antara halaman,
    // yg kalau tidak dimatikan malah ke-parse sbg "ide" tersendiri (lolos MIN_IDEA_LENGTH).
    const result = await parser.getText({ pageJoiner: "" });
    return result.text
      .split("\n")
      .map((line: string) => line.trim())
      .filter(isLikelyIdea);
  } finally {
    await parser.destroy();
  }
}

export async function parseIdeaFile(buffer: Buffer, filename: string): Promise<string[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseExcelIdeas(buffer);
  }
  if (lower.endsWith(".pdf")) {
    return parsePdfIdeas(buffer);
  }
  throw new Error("Format file tidak didukung - upload .xlsx, .xls, atau .pdf");
}
