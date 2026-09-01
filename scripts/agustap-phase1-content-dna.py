"""Phase 1 Foundation (PRD Agustap Studio Content Intelligence, §47) - isi Content DNA
brand Agustap Studio ke kolom `brands` yang SUDAH ADA (lihat docs/REUSE_MAP.md §9-10) -
murni data, tidak bikin tabel/kolom baru.

Jalankan LANGSUNG di server yang datanya ada (202.10.41.72):
  python3 scripts/agustap-phase1-content-dna.py
"""
import json
import sqlite3

DB_PATH = "data/kontenpilot.db"
BRAND_ID = "brand_P2BjJgQoG8hL"

NICHE = "Marketing & strategi konten untuk UMKM dan bisnis lokal"
TARGET_AUDIENCE = "UMKM, bisnis lokal, entrepreneur, business owner, creator bisnis"
POSITIONING = (
    "Agustap Studio = akun yang membedah masalah marketing bisnis dan membantu "
    "UMKM memahami cara mendapatkan perhatian dan pelanggan melalui konten."
)
TONE_OF_VOICE = "conversational, tajam, sederhana, praktis, tidak terlalu formal, tidak seperti textbook"
CTA_STYLE = "soft conversion - promosi kemampuan Agustap secara ringan, bukan hard-selling (PRD §8/§11)"
CONTENT_BOUNDARIES = (
    "WAJIB faceless - tidak ada talking head/avatar/presenter/face clone (PRD §20). "
    "Footage eksternal PEXELS sebagai sumber utama & default (PRD §25). "
    "Boleh: Pexels video/foto, screen recording, smartphone/laptop footage, business "
    "B-roll, product footage, screenshot, UI mockup, text animation, motion graphics. "
    "Belajar prinsip dari creator benchmark (hook/angle/pacing/storytelling), JANGAN "
    "PERNAH copy script/caption/kalimat/personal story/footage creator (PRD §14)."
)
CONTENT_PILLARS = {
    "pillars": [
        "Bedah UMKM",
        "Marketing Mistakes",
        "Before/After",
        "Kalau Saya Jadi Marketing",
        "Marketing Myth",
        "Practical Strategy",
        "Case Study",
        "Soft Conversion",
    ],
    "targetPercent": {},  # kosong -> equal split otomatis (lihat pillarTargetPercentForSite)
}


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    row = cur.execute("SELECT name, niche FROM brands WHERE id = ?", (BRAND_ID,)).fetchone()
    if not row:
        print(f"STOP: brand {BRAND_ID} tidak ditemukan di {DB_PATH}")
        return
    name, existing_niche = row
    if existing_niche:
        print(f"STOP: brand {name!r} sudah punya niche terisi ({existing_niche!r}) - "
              f"tidak ditimpa otomatis, cek manual dulu.")
        return
    # knowledge_site = "agustap_studio" (2026-09-01, Phase 1 Foundation §47) - REUSE
    # kolom existing yang SUDAH dipakai sebagai slug canonical per-brand (lihat pola
    # `knowledgeSite === "pelangi"` di generateContent.ts) - bukan bikin kolom slug
    # baru. Ini yang dipakai guard `isAgustapStudioBrand()` di
    # src/lib/agustap/featureFlag.ts.
    cur.execute(
        """UPDATE brands SET
            knowledge_site = 'agustap_studio',
            niche = ?, target_audience = ?, positioning = ?, tone_of_voice = ?,
            cta_style = ?, content_boundaries = ?, content_pillars = ?
           WHERE id = ?""",
        (
            NICHE, TARGET_AUDIENCE, POSITIONING, TONE_OF_VOICE,
            CTA_STYLE, CONTENT_BOUNDARIES, json.dumps(CONTENT_PILLARS, ensure_ascii=False),
            BRAND_ID,
        ),
    )
    conn.commit()
    print(f"OK: Content DNA brand {name!r} ({BRAND_ID}) terisi. Rows updated: {cur.rowcount}")
    conn.close()


if __name__ == "__main__":
    main()
