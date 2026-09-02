"""One-off: ganti profile SEED MANUAL (agustap-seed-remaining-v1-creators.py /
agustap-seed-test-benchmark.py) dengan hasil analisis ASLI dari konten publik
creator (via buildCreatorBenchmarkFromContentUrls, REUSE Inspiration Analyzer -
lihat RISK_MAP.md #5). Fetch HTTP polos hanya berhasil untuk sumber statis
(blog/newsletter), jadi baru 3 dari 6 creator yang bisa diganti sekarang:
Seth Godin, Justin Welsh, Neil Patel. Sisanya (Victoria Wong, Alex Hormozi,
Vanessa Lau) tetap SEED MANUAL - mereka creator video-native (TikTok/IG/YouTube
Shorts), JS-rendered, sesuai desain akan SOURCE_UNAVAILABLE tanpa headless
browser (bukan bug, lihat inspirationAnalyzer.ts).

Row SUDAH ADA (dibuat scripts/agustap-seed-*.py sebelumnya) - ini UPDATE, bukan
INSERT. Baris yang tidak disebut di REAL_PROFILES di bawah TIDAK disentuh.

Jalankan LANGSUNG di server yang datanya ada (202.10.41.72):
  python3 scripts/agustap-realbench-update-v1.py
"""
import json
import sqlite3
import time

DB_PATH = "data/kontenpilot.db"
BRAND_ID = "brand_P2BjJgQoG8hL"
REAL_NOTE_PREFIX = "[ANALISIS ASLI - dari konten publik nyata via Inspiration Analyzer]"

REAL_PROFILES = {
    "Seth Godin": {
        "account_url": "https://seths.blog/",
        "analyzed_content_count": 3,
        "profile": {
            "hookPattern": "Start with a thought-provoking insight or contrast that challenges common perceptions or introduces a cognitive/behavioral concept to engage curiosity.",
            "storytellingPattern": "Begin with defining or setting the context of a concept, use relatable examples or metaphors to illustrate, then build towards deeper implications or actionable insights.",
            "contentAngle": "Explores underlying psychological or behavioral patterns affecting performance, decision-making, or mindset, combining theory with practical application.",
            "pacing": "Methodical and steady progression that balances concise explanation with illustrative examples, allowing the audience to absorb and reflect before moving on.",
            "ctaPattern": "Encourage personal reflection and continuous improvement, often prompting the audience to reconsider their own behaviors or systems rather than one-time actions.",
            "visualPattern": "Use of simple models or metaphors (e.g., quadrant models, classroom settings) to clarify abstract concepts and deepen understanding.",
            "audiencePattern": "Targets thoughtful professionals interested in self-improvement, organizational effectiveness, and understanding human behavior in work contexts.",
        },
    },
    "Justin Welsh": {
        "account_url": "https://www.justinwelsh.me/newsletter",
        "analyzed_content_count": 3,
        "profile": {
            "hookPattern": "Start with a relatable or personal scenario that sparks curiosity or emotional engagement, often challenging common beliefs or highlighting a tension point.",
            "storytellingPattern": "Use personal narratives structured chronologically or with reflective pauses, combining conflict, introspection, lessons learned, and positive resolutions to model growth.",
            "contentAngle": "Focus on challenging default mindsets and empowering readers to reconsider their choices, emphasizing personal growth, leadership, and self-awareness.",
            "pacing": "Moderate to balanced pacing that blends reflective moments with engaging storytelling beats, gradually building toward empowerment or insight.",
            "ctaPattern": "Consistently invite the audience to follow on social platforms and join newsletters for ongoing insights and personal development content.",
            "visualPattern": "Not explicitly described in the analyses; likely minimal or supportive visuals aligned with personal storytelling.",
            "audiencePattern": "Target audience includes individuals interested in personal growth, leadership, entrepreneurship, and self-improvement who seek actionable insights and permission to pivot or rethink life and work choices.",
        },
    },
    "Neil Patel": {
        "account_url": "https://neilpatel.com/blog/",
        "analyzed_content_count": 2,
        "profile": {
            "hookPattern": "Starts with a direct question addressing audience's desire for visibility or success on Google",
            "storytellingPattern": "Introduce a problem, explain its importance or causes, provide actionable solutions or methods, conclude with benefits",
            "contentAngle": "Data-driven forecasting and planning to improve SEO or paid advertising outcomes",
            "pacing": "Balanced and steady flow mixing technical explanation with practical advice to maintain engagement",
            "ctaPattern": "Encourage readers to apply forecasting techniques or methods to improve their digital marketing strategies",
            "visualPattern": "Not specified in the given content",
            "audiencePattern": "Business owners or marketers seeking predictable growth, control, and efficiency in online visibility and advertising",
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
            print(f"SKIP (tidak ditemukan, seed belum jalan?): {name}")
            continue
        cur.execute(
            """UPDATE competitors
               SET account_url=?, benchmark_profile=?, analyzed_content_count=?,
                   notes=?, updated_at=?
               WHERE id=?""",
            (
                data["account_url"],
                json.dumps(data["profile"]),
                data["analyzed_content_count"],
                REAL_NOTE_PREFIX,
                now_ms,
                row[0],
            ),
        )
        print(f"UPDATED: {name} ({data['analyzed_content_count']} konten dianalisis)")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
