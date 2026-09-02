"""One-off: seed 1 Creator Benchmark MANUAL (bukan hasil analyzeInspiration
sungguhan - tidak ada URL konten asli yang bisa diakses saat ini) supaya wiring
Generation Strategy bisa diuji end-to-end. Profile ditulis berdasar pengetahuan
umum publik ttg gaya konten Alex Hormozi (hook problem-agitate-solve, value-first,
bahasa langsung tanpa basa-basi) - BUKAN hasil analisis video spesifik, jadi
`analyzed_content_count` sengaja NULL (bukan mengarang provenance seolah-olah
sudah dianalisis dari N video asli).

Ditandai jelas via prefix "[SEED MANUAL - belum dianalisis dari konten asli]" di
`notes` supaya siapa pun yang lihat data ini paham statusnya, dan gampang
diganti/dihapus nanti kalau sudah ada Creator Benchmark hasil analisis sungguhan.

Jalankan LANGSUNG di server yang datanya ada (202.10.41.72):
  python3 scripts/agustap-seed-test-benchmark.py
"""
import json
import sqlite3
import time
import uuid

DB_PATH = "data/kontenpilot.db"
BRAND_ID = "brand_P2BjJgQoG8hL"

PROFILE = {
    "hookPattern": "Buka dengan klaim/angka kontra-intuitif atau pertanyaan problem-agitate langsung dalam 2 detik pertama, tanpa basa-basi/perkenalan",
    "storytellingPattern": "Problem-Agitate-Solve: sebut masalah spesifik audiens, perbesar konsekuensi kalau dibiarkan, baru kasih solusi konkret",
    "contentAngle": "Value-first/tactical - selalu kasih 1 insight actionable yang bisa langsung dipakai, bukan cuma teori/motivasi kosong",
    "pacing": "Cepat, tanpa jeda filler - tiap kalimat membawa informasi baru, hindari pengulangan",
    "ctaPattern": "CTA implisit di akhir (follow untuk insight serupa) - jarang hard-sell langsung di badan konten",
    "visualPattern": "Text overlay besar menandai poin kunci, potongan cepat, minim b-roll dekoratif - fokus ke informasi",
    "audiencePattern": "Business owner/entrepreneur yang ingin solusi cepat & terukur, tidak sabar dengan konten bertele-tele",
}

NOTE_PREFIX = "[SEED MANUAL - belum dianalisis dari konten asli, ditulis dari pengetahuan umum publik]"


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    existing = cur.execute(
        "SELECT id FROM competitors WHERE brand_id = ? AND name = 'Alex Hormozi'", (BRAND_ID,)
    ).fetchone()
    if existing:
        print(f"STOP: sudah ada row Alex Hormozi (id={existing[0]}) - tidak ditimpa otomatis.")
        return
    now = int(time.time() * 1000)
    cur.execute(
        """INSERT INTO competitors
           (id, brand_id, name, notes, created_at, updated_at, account_url,
            benchmark_profile, role, benchmark_active, analyzed_content_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            f"comp_{uuid.uuid4().hex[:20]}", BRAND_ID, "Alex Hormozi", NOTE_PREFIX,
            now, now, None, json.dumps(PROFILE, ensure_ascii=False),
            "hook / attention / problem framing", 1, None,
        ),
    )
    conn.commit()
    print("OK: Creator Benchmark seed 'Alex Hormozi' dibuat, benchmark_active=1")
    conn.close()


if __name__ == "__main__":
    main()
