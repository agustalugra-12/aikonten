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
# --max-time dinaikkan 1700 -> 10700 (2026-08-11, bug nyata ditemukan - lihat catatan
# lengkap di kontenpilot-auto-generate.service TimeoutStartSec, angka ini SENGAJA
# dipasangkan sedikit di bawah situ) - batch auto-generate semalam TERBUKTI masih aktif
# proses ide SATU JAM PENUH stlh mulai (dicek langsung di journalctl
# kontenpilot-backend.service), jauh melebihi 1700dtk (~28menit) yg lama - curl
# TIMEOUT/putus duluan padahal proses generate sungguhan (server long-running TERPISAH,
# TIDAK ikut berhenti saat koneksi klien putus) tetap jalan sampai selesai. Status
# "curl gagal"/"service failed" SELAMA INI seringkali cuma berarti "curl bosan nunggu",
# bukan sinyal kontennya benar2 gagal - naikkan supaya wrapper ini benar2 nunggu sampai
# respons asli (atau baru genuinely timeout kalau proses beneran macet berjam-jam).
# Dipakai bareng utk endpoint LAIN yg dipanggil script sama (mis. daily-ideas, jauh
# lebih cepat) - timeout longgar tidak merugikan job yg cepat, cuma jadi jaring pengaman
# lebih longgar.
curl -sf --max-time 10700 -X POST "http://localhost:3100$1" -H "X-Cron-Key: $SECRET" -w "\nHTTP %{http_code}\n"
