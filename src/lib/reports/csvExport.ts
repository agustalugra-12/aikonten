// CSV export helper untuk laporan KontenPilot (Phase 6).
// RFC-4180 compliant + sanitasi sederhana utk mencegah CSV injection
// (cell formula seperti =CMD|'...'!A1 dieksekusi beberapa spreadsheet reader).

export function sanitizeCell(raw: unknown): string {
  let value = raw === null || raw === undefined ? "" : String(raw);

  // Neutralisasi karakter formula/injection di awal cell dengan tab prefix.
  // Spreadsheet akan menampilkan teks apa adanya, bukan mengeksekusi formula.
  if (/^[\-=+@\t\r\n]/.test(value)) {
    value = "\t" + value;
  }

  // Escape kutip ganda RFC-4180
  value = value.replace(/"/g, '""');

  // Wrap dalam kutip jika mengandung koma, kutip, newline, atau carriage return
  if (/[",\n\r]/.test(value)) {
    value = `"${value}"`;
  }

  return value;
}

export function objectsToCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; label: string }[]
): string {
  const header = columns.map((c) => sanitizeCell(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => sanitizeCell(row[c.key])).join(",")
  );
  return [header, ...lines].join("\r\n");
}
