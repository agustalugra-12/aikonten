#!/usr/bin/env bash
# Pantau render saat onboarding bertahap (2026-10-24). READ-ONLY: tak mengubah apa pun.
# Menampilkan 6 sinyal dari kondisi & log yang sudah ada (tanpa infra baru).
# Pakai: scripts/render-watch.sh   (atau: watch -n30 scripts/render-watch.sh)
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=data/kontenpilot.db
echo "===== RENDER WATCH $(date '+%F %T %Z') ====="
echo "[1] RAM & render aktif : ffmpeg_aktif=$(pgrep -c ffmpeg) | load=$(cut -d' ' -f1-3 /proc/loadavg) | RAM avail=$(free -m|awk 'NR==2{print $7}')MB"
echo "[2] Antrean tertunda   : $(sudo journalctl -u aikonten-saas --since today 2>/dev/null | grep -cE 'antrian ffmpeg penuh|render ditunda|Resource tidak cukup') kejadian hari ini"
echo "[3] Kegagalan render   : $(sudo journalctl -u aikonten-saas --since today 2>/dev/null | grep -cE 'dihentikan paksa|OOM|ffmpeg gagal') hari ini | project status=failed: $(sqlite3 "$DB" "SELECT COUNT(*) FROM projects WHERE status='failed'")"
echo "[4] Durasi video pendek: (cek journal render terakhir)"; sudo journalctl -u aikonten-saas --since today 2>/dev/null | grep -oE 'render.*(detik|menit|[0-9.]+s)' | tail -2 | sed 's/^/    /'
echo -n "[5] Respons website    : "; curl -s -o /dev/null -w "/api/health %{http_code} %{time_total}s\n" --max-time 8 http://localhost:3200/api/health
echo "[6] Ketepatan jadwal   :"; systemctl list-timers --all 2>/dev/null | grep -iE 'auto-generate|auto-publish' | awk '{print "    "$0}' | head -4
echo "    run auto-generate terakhir: $(sudo journalctl -u kontenpilot-auto-generate --since -2days 2>/dev/null | grep -oE 'HTTP [0-9]+|generated[^,}]*' | tail -2 | tr '\n' ' ')"
