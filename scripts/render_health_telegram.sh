#!/usr/bin/env bash
# Digest kesehatan render semalam -> Telegram (setup 2026-09-12, ganti job sesi-only).
# Reuse TELEGRAM_BOT_TOKEN/CHAT_ID dari .env app. Window = 12 jam terakhir (cron ~07:12 WIB
# -> tangkap render 23:00-02:15 + cap 180min). Fokus: masih ada timeout render atau tidak.
set -uo pipefail
cd /home/admin/kontenpilot-ai || exit 1
DB=data/kontenpilot.db
TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '\r')
CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' .env | head -1 | cut -d= -f2- | tr -d '\r')
if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then echo "no telegram cfg"; exit 1; fi

WIN="updated_at > strftime('%s','now','-12 hours')"

FAILED=$(sqlite3 "$DB" "SELECT COUNT(*) FROM projects WHERE status='failed' AND $WIN;")
FAILED=${FAILED:-0}
# Hanya kirim kalau ADA yang gagal (timeout = subset failed). Kalau sehat, diam.
[ "$FAILED" -eq 0 ] && { echo "sehat (0 gagal), tidak kirim"; exit 0; }

STATUS=$(sqlite3 "$DB" "SELECT status || ': ' || COUNT(*) FROM projects WHERE $WIN GROUP BY status ORDER BY COUNT(*) DESC;" | paste -sd', ' -)
[ -z "$STATUS" ] && STATUS="(tak ada aktivitas render)"

TO=$(sqlite3 "$DB" "SELECT COUNT(*) FROM projects WHERE status='failed' AND (error_message LIKE '%melebihi%' OR error_message LIKE '%timeout%') AND $WIN;")
TO=${TO:-0}

CAP=$(sqlite3 "$DB" "SELECT CASE WHEN SUM(error_message LIKE '%180 menit%')>0 THEN '180min' WHEN SUM(error_message LIKE '%120 menit%')>0 THEN 'MASIH 120min (env belum kebaca!)' ELSE '-' END FROM projects WHERE status='failed' AND $WIN;")
[ -z "$CAP" ] && CAP="-"

UNITS=$(systemctl --failed --no-legend 2>/dev/null | grep -c ffmpeg)

MSG="⚠️ <b>Render malam KontenPilot — ada gagal</b>
Status: ${STATUS}
Timeout: <b>${TO}</b> (cap: ${CAP})
Total gagal: <b>${FAILED}</b> | Unit ffmpeg failed: ${UNITS}"

DETAIL=$(sqlite3 "$DB" "SELECT '- ' || brand_id || ' ' || id || ': ' || substr(replace(error_message, char(10), ' '), 1, 90) FROM projects WHERE status='failed' AND $WIN ORDER BY updated_at DESC LIMIT 10;")
[ -n "$DETAIL" ] && MSG="$MSG"$'\n\n'"$DETAIL"

export MSG CHAT
PAYLOAD=$(python3 -c 'import json,os; print(json.dumps({"chat_id":os.environ["CHAT"],"text":os.environ["MSG"],"parse_mode":"HTML"}))')
curl -s -m 20 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" -H "Content-Type: application/json" -d "$PAYLOAD" >/dev/null && echo "sent"
