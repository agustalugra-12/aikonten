"""One-off: seed 5 Creator Benchmark V1 tersisa (PRD §2.9) - SAMA POLA dgn
agustap-seed-test-benchmark.py (Alex Hormozi, sudah dibuat sebelumnya). SEED
MANUAL berdasar pengetahuan umum publik ttg gaya konten tiap creator (role-nya
mengikuti CREATOR_BENCHMARK_V1_SEED di creatorBenchmark.ts) - BUKAN hasil
analyzeInspiration dari video asli (belum ada URL konten yang bisa diakses),
`analyzed_content_count` sengaja NULL. Ditandai jelas via prefix notes yang sama
supaya gampang diganti nanti dgn Creator Benchmark hasil analisis sungguhan.

Jalankan LANGSUNG di server yang datanya ada (202.10.41.72):
  python3 scripts/agustap-seed-remaining-v1-creators.py
"""
import json
import sqlite3
import time
import uuid

DB_PATH = "data/kontenpilot.db"
BRAND_ID = "brand_P2BjJgQoG8hL"
NOTE_PREFIX = "[SEED MANUAL - belum dianalisis dari konten asli, ditulis dari pengetahuan umum publik]"

CREATORS = [
    {
        "name": "Victoria Wong",
        "role": "storytelling / content / social media",
        "profile": {
            "hookPattern": "Buka dengan momen personal/relatable yang langsung menarik empati (mis. kesalahan sendiri, pengalaman gagal) sebelum masuk ke pelajaran kontennya",
            "storytellingPattern": "Narasi personal orang-pertama - cerita pengalaman nyata dulu, baru ditarik jadi pelajaran/prinsip konten yang bisa dipakai audiens",
            "contentAngle": "Belajar dari pengalaman sendiri sbg creator/social media strategist - jujur soal proses trial-error, bukan cuma hasil akhir yang sudah rapi",
            "pacing": "Sedang, ada jeda utk membangun koneksi emosional sebelum masuk poin taktis",
            "ctaPattern": "Ajakan halus utk follow/ikuti journey lanjutan, jarang hard-sell produk di badan konten",
            "visualPattern": "Talking-to-camera casual/vlog-style, caption teks pendukung poin kunci, editing natural bukan terlalu produksi tinggi",
            "audiencePattern": "Aspiring content creator/social media manager yang ingin belajar dari pengalaman nyata, bukan teori buku",
        },
    },
    {
        "name": "Justin Welsh",
        "role": "simplification / business content",
        "profile": {
            "hookPattern": "Klaim hasil/angka spesifik di awal (mis. pendapatan, jumlah audiens) yang membuktikan kredibilitas sebelum kasih framework",
            "storytellingPattern": "Framework/sistem bernomor - masalah umum solopreneur, lalu breakdown langkah demi langkah yang terstruktur rapi",
            "contentAngle": "Simplifikasi bisnis kompleks jadi sistem yang bisa dieksekusi sendirian (solopreneur/one-person-business)",
            "pacing": "Cepat &amp; padat, tiap poin diberi nomor/label jelas, minim basa-basi",
            "ctaPattern": "Arahkan ke newsletter/produk digital sendiri sbg 'pelajari lebih lanjut', disampaikan sbg lanjutan logis bukan jualan paksa",
            "visualPattern": "Teks-berat (carousel/slide bernomor), minim b-roll, fokus ke tipografi &amp; struktur visual framework",
            "audiencePattern": "Solopreneur/freelancer yang ingin sistem bisnis simpel tanpa tim besar",
        },
    },
    {
        "name": "Neil Patel",
        "role": "marketing education",
        "profile": {
            "hookPattern": "Pertanyaan langsung ttg masalah marketing yang umum dialami ('kenapa website kamu tidak dapat traffic') diikuti janji jawaban konkret",
            "storytellingPattern": "Edukasi mendalam step-by-step - jelaskan KENAPA sebelum BAGAIMANA, sering pakai data/studi kasus nyata",
            "contentAngle": "Deep-dive teknis marketing digital (SEO/traffic/growth) dgn bukti data, bukan opini semata",
            "pacing": "Sedang-lambat, sengaja detail krn kontennya edukasional/tutorial, tidak takut konten panjang kalau memang perlu",
            "ctaPattern": "Ajak coba tool/strategi yang baru dijelaskan, sering arahkan ke resource gratis tambahan",
            "visualPattern": "Screen recording/data visualization (grafik, dashboard), teks overlay berisi angka/statistik",
            "audiencePattern": "Marketer/business owner yang serius ingin belajar teknis, bukan sekadar cari motivasi cepat",
        },
    },
    {
        "name": "Vanessa Lau",
        "role": "creator strategy",
        "profile": {
            "hookPattern": "Bongkar 'behind the scenes' angka/strategi asli (views, pendapatan, proses) yang biasanya tidak ditunjukkan creator lain",
            "storytellingPattern": "Transparansi radikal - tunjukkan proses nyata (bukan cuma hasil akhir), sering format 'ini yang sebenarnya saya lakukan'",
            "contentAngle": "Strategi personal branding &amp; bisnis untuk creator/online business owner, dari sudut pandang praktisi bukan cuma teori",
            "pacing": "Energik, transisi cepat antar poin, banyak jeda visual utk penekanan",
            "ctaPattern": "Arahkan ke course/komunitas sendiri sbg next-step, dibungkus sbg 'kalau mau belajar lebih detail'",
            "visualPattern": "Talking-head energik + screen-share data asli (analytics), warna cerah &amp; branding konsisten",
            "audiencePattern": "Aspiring online business owner/creator yang ingin strategi konkret dari orang yang sudah terbukti berhasil",
        },
    },
    {
        "name": "Seth Godin",
        "role": "positioning / marketing psychology",
        "profile": {
            "hookPattern": "Kalimat pembuka singkat &amp; provokatif yang membalik asumsi umum (kontra-intuitif), sering berbentuk pernyataan bukan pertanyaan",
            "storytellingPattern": "Esai/ide pendek - satu konsep per konten, dieksplorasi lewat analogi/perspektif baru, tanpa struktur listicle formal",
            "contentAngle": "Filosofi &amp; psikologi marketing/positioning - KENAPA orang bertindak begitu, bukan taktik teknis how-to",
            "pacing": "Sangat padat/singkat - tiap kalimat berdiri sendiri, banyak white space konseptual utk direnungkan",
            "ctaPattern": "Nyaris tidak ada CTA eksplisit - konten dibiarkan 'mengajak berpikir', bukan mengarahkan aksi langsung",
            "visualPattern": "Minimalis - teks polos/tipografi sederhana, hampir tanpa elemen visual dekoratif",
            "audiencePattern": "Marketer/pemikir bisnis yang mencari perspektif konseptual, bukan solusi taktis instan",
        },
    },
]


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now = int(time.time() * 1000)
    created = 0
    for c in CREATORS:
        existing = cur.execute(
            "SELECT id FROM competitors WHERE brand_id = ? AND name = ?", (BRAND_ID, c["name"])
        ).fetchone()
        if existing:
            print(f"SKIP: {c['name']} sudah ada (id={existing[0]})")
            continue
        cur.execute(
            """INSERT INTO competitors
               (id, brand_id, name, notes, created_at, updated_at, account_url,
                benchmark_profile, role, benchmark_active, analyzed_content_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                f"comp_{uuid.uuid4().hex[:20]}", BRAND_ID, c["name"], NOTE_PREFIX,
                now, now, None, json.dumps(c["profile"], ensure_ascii=False),
                c["role"], 1, None,
            ),
        )
        created += 1
        print(f"OK: {c['name']} dibuat, benchmark_active=1")
    conn.commit()
    print(f"\nTotal {created} creator baru dibuat.")
    conn.close()


if __name__ == "__main__":
    main()
