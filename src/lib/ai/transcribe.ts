import OpenAI from "openai";

export type TranscriptSegment = {
  start: number; // detik
  end: number; // detik
  text: string;
  avgLogprob: number; // proxy kejelasan audio - makin dekat 0 makin jelas
};

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// Transkripsi footage mentah lewat Whisper - hasilnya dipakai DUA kali: (1) jadi dasar
// pemilihan klip otomatis (clipSelect.ts), (2) jadi dasar subtitle final. fileUrl harus
// URL publik (dari storage.ts) krn OpenAI ambil file itu sendiri lewat network.
export async function transcribeFootage(fileUrl: string): Promise<TranscriptSegment[]> {
  const client = getClient();
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    throw new Error(`Gagal ambil file utk transkripsi: ${fileRes.status} ${fileRes.statusText}`);
  }
  const blob = await fileRes.blob();
  // PENTING (bug nyata ditemukan 2026-07-30 - jalur video tidak pernah benar2 dites
  // end-to-end sebelumnya, semua tes publish real session ini kebetulan foto/carousel):
  // Whisper API deteksi format dari EKSTENSI NAMA FILE, bukan cuma header Content-Type -
  // filename tanpa ekstensi ("footage" doang) selalu ditolak "Unrecognized file format"
  // walau isinya mp4 asli & valid.
  const contentType = blob.type || "video/mp4";
  const ext = contentType.split("/")[1]?.split(";")[0] || "mp4";
  const file = new File([blob], `footage.${ext}`, { type: contentType });

  const result = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  // response_format verbose_json - SDK type resminya cuma expose `text`, segments ada
  // di response mentah (field tambahan API yg belum sepenuhnya di-type SDK-nya).
  const raw = result as unknown as {
    segments?: Array<{ start: number; end: number; text: string; avg_logprob: number }>;
  };

  return (raw.segments || []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
    avgLogprob: s.avg_logprob,
  }));
}
