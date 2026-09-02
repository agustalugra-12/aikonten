"""One-off: lanjutan agustap-realbench-update-v1.py - ganti 3 Creator Benchmark
SEED MANUAL tersisa (Alex Hormozi, Victoria Wong, Vanessa Lau) dengan hasil
analisis nyata. BEDA sumber dari v1 (yang pakai tulisan ASLI creator sendiri -
blog Seth Godin dkk): ketiga creator ini video-native (TikTok/IG/YouTube
Shorts), fetch HTTP polos tidak bisa akses konten videonya langsung. Sumber
yang dipakai di sini adalah ARTIKEL PIHAK KETIGA yang menganalisis gaya/pola
konten mereka secara kredibel (interview transcript/analisis gaya tertulis),
BUKAN post asli mereka - ditandai beda dari v1 (`account_url` tetap kosong,
notes eksplisit bilang ini analisis pihak ketiga, `analyzed_content_count=1`
per creator karena cuma 1 artikel per creator, bukan agregasi multi-post).

Jalankan LANGSUNG di server yang datanya ada (202.10.41.72):
  python3 scripts/agustap-realbench-update-v2.py
"""
import json
import sqlite3
import time

DB_PATH = "data/kontenpilot.db"
BRAND_ID = "brand_P2BjJgQoG8hL"
NOTE_PREFIX = (
    "[ANALISIS DARI ARTIKEL PIHAK KETIGA - bukan post asli creator langsung "
    "(video-native, tidak bisa di-fetch polos), tapi analisis gaya/pola kredibel "
    "dari sumber tertulis ttg mereka]"
)

REAL_PROFILES = {
    "Alex Hormozi": {
        "source_url": "https://connectsafely.ai/articles/how-to-write-like-alex-hormozi-linkedin-2026",
        "profile": {
            "hookPattern": "Use confident verdicts, numbers, contrarian reframes, and identity claims to provoke agreement or argument",
            "storytellingPattern": "Claim followed by three supporting bullets, ending with a concise takeaway punchline",
            "contentAngle": "Present bold, clear claims that challenge common beliefs and offer new mental models",
            "pacing": "Short, dense posts with line breaks every 1-2 sentences for quick skimming and fast comprehension",
            "ctaPattern": "No direct calls to comment; engagement is driven by the provocative tone and share-worthy takeaways",
            "visualPattern": "Not specified in the content provided",
            "audiencePattern": "Targets audience that responds to authority, certainty, debate, identity signaling, and social proof",
        },
    },
    "Victoria Wong": {
        "source_url": "https://jabar.idntimes.com/news/jawa-barat/bimbing-30-ribu-konten-kreator-intip-kisah-victoria-wong-00-dzkhf-l6qb6v",
        "profile": {
            "hookPattern": "Highlight inspiring success stories starting from humble beginnings to attract and motivate aspiring creators.",
            "storytellingPattern": "Narrative structure that begins with personal background struggles, followed by a detailed growth journey, and culminates in showcasing positive impact on others.",
            "contentAngle": "Focus on transformation achieved through education and consistent effort despite early financial or personal challenges.",
            "pacing": "Balanced and smooth progression from personal hardship to achievement and then to community influence, maintaining audience engagement throughout.",
            "ctaPattern": "Calls to action encouraging the audience to join educational programs or academies to leverage content creation for income generation.",
            "visualPattern": "Not specified in the provided content; no consistent visual pattern identified.",
            "audiencePattern": "Targets aspiring content creators seeking inspiration, practical growth strategies, and community support to overcome challenges and succeed.",
        },
    },
    "Vanessa Lau": {
        "source_url": "https://www.socialmediaexaminer.com/instagram-strategy-growing-followers-and-business-vanessa-lau/",
        "profile": {
            "hookPattern": "Start with addressing common mistakes or pain points relevant to the target audience to immediately grab attention.",
            "storytellingPattern": "Use personal career pivot or transformation stories that demonstrate credibility and relatable success.",
            "contentAngle": "Focus on transitioning from traditional work (e.g., quitting 9-5) to building a personal brand and client base through Instagram.",
            "pacing": "Balanced structure combining problem identification, solution explanation, and actionable tips for practical value.",
            "ctaPattern": "Encourage multi-platform following and direct engagement through DMs and interactive elements like polls.",
            "visualPattern": "Not specified in the provided content, so no pattern can be determined.",
            "audiencePattern": "Target marketers and aspiring entrepreneurs seeking quick client acquisition and growth on Instagram.",
        },
    },
}


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now_ms = int(time.time() * 1000)

    for name, data in REAL_PROFILES.items():
        cur.execute(
            "SELECT id FROM competitors WHERE brand_id=? AND name=?",
            (BRAND_ID, name),
        )
        row = cur.fetchone()
        if not row:
            print(f"SKIP (tidak ditemukan): {name}")
            continue
        cur.execute(
            """UPDATE competitors
               SET account_url=?, benchmark_profile=?, analyzed_content_count=?,
                   notes=?, updated_at=?
               WHERE id=?""",
            (
                data["source_url"],
                json.dumps(data["profile"]),
                1,
                NOTE_PREFIX,
                now_ms,
                row[0],
            ),
        )
        print(f"UPDATED: {name}")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
