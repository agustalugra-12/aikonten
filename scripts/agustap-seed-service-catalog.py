"""One-off: isi service_catalog Agustap Studio dari data NYATA repo
agustalugra-12/webagustapstudio (src/components/Pricing.tsx, Hero.tsx, Solution.tsx) -
BUKAN dikarang AI, sesuai PRD "Agustap Studio Content Clarity" §5/§20 (source of truth
wajib nyata). Dipakai checkContentClarity() (contentClarity.ts) utk validasi konten
promotional/package.

Jalankan LANGSUNG di server yang datanya ada (202.10.41.72):
  python3 scripts/agustap-seed-service-catalog.py
"""
import json
import sqlite3
import time

DB_PATH = "data/kontenpilot.db"
BRAND_ID = "brand_P2BjJgQoG8hL"

SERVICE_CATALOG = {
    "serviceDescription": (
        "Agustap Studio menangani riset, strategi, produksi, publishing, dan evaluasi "
        "konten untuk membantu bisnis membangun awareness, audience, dan peluang "
        "penjualan secara organik (Social Media Management)."
    ),
    "packages": [
        {"name": "BASIC", "price": "Rp1.500.000", "features": ["2 video/hari", "1 poster/hari", "90 konten/bulan"]},
        {"name": "GROWTH", "price": "Rp1.800.000", "features": ["4 video/hari", "2 poster/hari", "180 konten/bulan"]},
        {"name": "PRO", "price": "Rp2.500.000", "features": ["6 video/hari", "3 poster/hari", "270 konten/bulan"]},
    ],
    "commonFeatures": [
        "Business Research", "Content Strategy", "Content Production", "SEO Social Media",
        "TikTok", "Instagram", "Publishing", "Analytics / Optimization sesuai paket",
    ],
    "addOns": ["Facebook +Rp250.000/bulan"],
}


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT service_catalog FROM brands WHERE id=?", (BRAND_ID,))
    row = cur.fetchone()
    if row is None:
        print("SKIP: brand tidak ditemukan")
        return
    if row[0]:
        print("SKIP: service_catalog sudah terisi, tidak ditimpa (jalankan manual kalau memang mau update)")
        return
    cur.execute(
        "UPDATE brands SET service_catalog=? WHERE id=?",
        (json.dumps(SERVICE_CATALOG), BRAND_ID),
    )
    conn.commit()
    conn.close()
    print("UPDATED: service_catalog Agustap Studio terisi (3 paket + common features + add-on)")


if __name__ == "__main__":
    main()
