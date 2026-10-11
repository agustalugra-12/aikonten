#!/bin/bash
# Wrapper cron SAAS (2026-10-11, #2). Pola sama scripts/cron/call-endpoint.sh app utama,
# beda PORT (saas=3200, bukan 3100). Baca CRON_SECRET dari .env saas (jangan hardcode di
# unit systemd yg kebaca `systemctl cat`) lalu POST ke endpoint cron internal lokal.
# $1 = path endpoint (mis. /api/cron/check-expiry).
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRET=$(grep "^CRON_SECRET=" .env | sed 's/^CRON_SECRET=//')
if [ -z "$SECRET" ]; then echo "CRON_SECRET belum diisi di .env" >&2; exit 1; fi
curl -sf --max-time 120 -X POST "http://localhost:3200$1" -H "X-Cron-Key: $SECRET" -w "\nHTTP %{http_code}\n"
