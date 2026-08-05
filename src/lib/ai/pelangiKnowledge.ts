// Knowledge Base Pelangi (2026-08-05, permintaan Agus - "aku mau pengetahuan untuk ide
// konten bisa kamu ambil dari website pelangi... agar konteks konten tidak keluar jalur"
// - dikutip persis: "ini adalah titik yang akan membedakan AI Content milikmu dengan AI
// video generator lain"). BUKAN knowledge base baru dari nol - REUSE PERSIS fakta yg
// SUDAH ada & battle-tested di web-pelangi/backend/scripts/seo_agent.py
// (_fetch_site_facts, dipakai fact_check() SEO Agent sejak lama): kamar/harga/fasilitas,
// EKSPLISIT daftar fasilitas yg TIDAK dimiliki (kolam renang/pet/meeting room/rental
// mobil-motor/airport transfer/paket tur), & fakta radius/jarak landmark wisata sekitar
// Bedugul. Diambil via HTTP internal (localhost, app Python terpisah) - lihat
// GET /api/admin/content-facts di web-pelangi/backend/server.py.
//
// Cache in-memory 15 menit - fakta ini TIDAK berubah tiap menit (harga kamar/fasilitas
// jarang diedit), tidak perlu fetch ulang tiap generate konten (nambah latency tanpa
// manfaat nyata).
//
// Di-keyed PER SITE (2026-08-05, bug nyata ditemukan sendiri saat nambah fitur per-brand
// knowledgeSite - SEBELUM ini cache cuma 1 variabel global, TIDAK dibedakan per `site`.
// Selama brand cuma 1 [Pelangi] bug ini tidak pernah kelihatan, TAPI begitu Harmoni
// ditambahkan sbg brand kedua, permintaan fetchPelangiKnowledge("harmoni") dalam 15 menit
// setelah fetchPelangiKnowledge("pelangi") akan SALAH balikin fakta Pelangi yg ke-cache -
// persis kelas bug "leak data lintas properti" yg sudah pernah ditemukan & diperbaiki di
// tempat lain sesi ini [guest_profiles]. Diperbaiki SEBELUM Harmoni sungguhan ditambahkan,
// bukan menunggu bug itu benar2 kejadian.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { text: string; fetchedAt: number }>();

export async function fetchPelangiKnowledge(site: string = "pelangi"): Promise<string> {
  const cached = cache.get(site);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.text;
  }

  const baseUrl = process.env.WEB_PELANGI_INTERNAL_URL;
  const internalKey = process.env.WEB_PELANGI_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    // Nullable by design - kalau belum dikonfigurasi (mis. env lokal dev), fitur grounding
    // dilewati begitu saja (bukan error keras) supaya generate konten tetap jalan spt
    // sebelumnya, cuma tanpa grounding tambahan.
    return "";
  }

  try {
    const res = await fetch(`${baseUrl}/api/admin/content-facts?site=${encodeURIComponent(site)}`, {
      headers: { "X-Internal-Key": internalKey },
    });
    if (!res.ok) {
      console.error(`[pelangiKnowledge] gagal ambil fakta (${res.status}), lanjut TANPA grounding kali ini`);
      return cached?.text || "";
    }
    const data = await res.json();
    const text: string = data.facts || "";
    cache.set(site, { text, fetchedAt: Date.now() });
    return text;
  } catch (err) {
    console.error("[pelangiKnowledge] gagal hubungi web-pelangi backend:", err);
    return cached?.text || "";
  }
}

// Knowledge Base manual (2026-08-05, permintaan Agus - "setiap brand bisa mengisi
// pengetahuan secara manual") - MELENGKAPI fakta otomatis di atas, bukan menggantikan.
// Digabung di SATU tempat (bukan diulang di tiap pemanggil) supaya konsisten dipakai
// researchTopics.ts (ide) & generateContent.ts (caption).
export function mergeManualKnowledge(autoKnowledge: string, manualKnowledge?: string | null): string {
  const manual = (manualKnowledge || "").trim();
  if (!manual) return autoKnowledge;
  const manualBlock = `Pengetahuan tambahan dari owner (manual, boleh dikutip sama seperti fakta di atas):\n${manual}`;
  return autoKnowledge ? `${autoKnowledge}\n\n${manualBlock}` : manualBlock;
}
