#!/bin/bash
# Wrapper dipanggil systemd timer (2026-08-06) - baca CRON_SECRET dari .env (BUKAN
# hardcode di unit file systemd, yg isinya kebaca siapa saja lewat `systemctl cat`/
# `journalctl`) lalu POST ke endpoint cron internal lokal. $1 = path endpoint (mis.
# "/api/cron/daily-ideas").
set -euo pipefail
cd /root/kontenpilot-ai
SECRET=$(grep "^CRON_SECRET=" .env | sed 's/^CRON_SECRET=//')
if [ -z "$SECRET" ]; then
  echo "CRON_SECRET belum diisi di .env" >&2
  exit 1
fi
# --max-time longgar (2026-08-06) - auto-generate bisa proses beberapa ide sekaligus
# (render video/poster per ide, panggilan API berbayar + ffmpeg), curl default TIDAK
# ADA batas waktu tapi systemd TimeoutStartSec per service yg atur batas sesungguhnya -
# --max-time di sini cuma jaring pengaman tambahan spy curl sendiri tidak nyangkut mati.
curl -sf --max-time 1700 -X POST "http://localhost:3100$1" -H "X-Cron-Key: $SECRET" -w "\nHTTP %{http_code}\n"
