"""Skrip koreksi manual satu kali (2026-08-20) - Laundry in Bali + Animal Story & Co
migrasi penuh ke VPS baru (aikonten.agustapstudio.com, 202.10.41.72, sudah diverifikasi
data tersinkron + service jalan sehat sebelum skrip ini dijalankan). Hapus data 2 brand
ini dari server LAMA supaya tidak ada 2 server memproses brand yang sama (resiko
dobel-generate/dobel-publish ke akun sosial media yang sama). Urutan DELETE mengikuti FK
(anak sebelum induk) - sama pola dgn prune_pelangi.py yang sudah dites di VPS baru.

Jalankan SEKALI: venv atau python3 -m scripts.prune_migrated_brands (dari backend root)
- app ini Next.js/TS, jalankan langsung: python3 scripts/prune_migrated_brands.py
"""
import sqlite3

DB = "data/kontenpilot.db"
BRAND_IDS = ["brand_Xmae1oEWdDUX", "brand_Wo1tv4SSj_ac"]  # laundry in bali, Animal Story & Co

con = sqlite3.connect(DB)
con.execute("PRAGMA foreign_keys = ON")
cur = con.cursor()

def run(sql, params=()):
    cur.execute(sql, params)
    print(f"{cur.rowcount:>5} rows - {sql.split('WHERE')[0].strip()}")

for brand_id in BRAND_IDS:
    print(f"\n=== {brand_id} ===")
    project_ids_q = "SELECT id FROM projects WHERE brand_id = ?"
    social_ids_q = "SELECT id FROM social_accounts WHERE brand_id = ?"

    run(f"DELETE FROM media_assets WHERE project_id IN ({project_ids_q})", (brand_id,))
    run(f"DELETE FROM publish_logs WHERE project_id IN ({project_ids_q}) OR social_account_id IN ({social_ids_q})", (brand_id, brand_id))
    run(f"DELETE FROM analytics WHERE social_account_id IN ({social_ids_q})", (brand_id,))
    run(f"DELETE FROM channel_profiles WHERE social_account_id IN ({social_ids_q})", (brand_id,))
    run("DELETE FROM footage_bank WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM footage_categories WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM daily_ideas WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM manual_ideas WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM storyboards WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM music_bank WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM platform_policies WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM competitors WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM llm_usage_log WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM projects WHERE brand_id = ?", (brand_id,))
    run(f"DELETE FROM youtube_series WHERE social_account_id IN ({social_ids_q})", (brand_id,))
    run("DELETE FROM social_accounts WHERE brand_id = ?", (brand_id,))
    run("DELETE FROM brands WHERE id = ?", (brand_id,))

con.commit()

cur.execute("SELECT id, name FROM brands")
print("\nRemaining brands:", cur.fetchall())
con.close()
