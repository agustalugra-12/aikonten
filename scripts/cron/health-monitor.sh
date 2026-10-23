#!/usr/bin/env bash
# Monitor uptime SaaS (2026-10-23). Cek /api/health; alert Telegram HANYA saat status
# BERUBAH (up->down / down->up) biar tak spam. State di file. Dijadwalkan systemd timer
# tiap 5 menit. CATATAN: ini self-monitor (jalan di VPS yg sama) - menangkap app crash /
# DB mati / health 503. Outage jaringan-keluar TOTAL tak bisa kirim alert (Telegram ikut
# tak terjangkau) - utk itu butuh monitor eksternal (mis. UptimeRobot) terpisah.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="${HEALTH_STATE:-$PWD/.health-state}"
URL="${HEALTH_URL:-http://localhost:3200/api/health}"
TG_T=$(grep '^TELEGRAM_BOT_TOKEN=' .env | sed 's/^TELEGRAM_BOT_TOKEN=//')
TG_C=$(grep '^TELEGRAM_CHAT_ID=' .env | sed 's/^TELEGRAM_CHAT_ID=//')
alert(){
  if [ "${DRYRUN:-}" = 1 ]; then echo "[ALERT] $1"; return; fi
  [ -n "$TG_T" ] && [ -n "$TG_C" ] && curl -s "https://api.telegram.org/bot$TG_T/sendMessage" \
    --data-urlencode "chat_id=$TG_C" --data-urlencode "text=$1" -o /dev/null --max-time 15 || true
}
BODY=$(curl -sf --max-time 10 "$URL" 2>/dev/null || true)
if echo "$BODY" | grep -q '"ok":true'; then NOW=up; else NOW=down; fi
PREV=$(cat "$STATE" 2>/dev/null || echo up)
echo "$NOW" > "$STATE"
TS=$(date '+%F %T %Z')
if [ "$NOW" != "$PREV" ]; then
  if [ "$NOW" = down ]; then alert "🔴 KontenPilot SaaS DOWN — /api/health gagal ($TS). Cek: sudo systemctl status aikonten-saas"
  else alert "🟢 KontenPilot SaaS PULIH ($TS)."; fi
fi
echo "$TS status=$NOW (prev=$PREV)"
