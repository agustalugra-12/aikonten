#!/bin/bash
# deploy-kontenpilot.sh - Deploy KontenPilot ke semua server
# Usage: ./scripts/deploy-kontenpilot.sh

set -e

echo "=== Deploying KontenPilot AI ==="

# 1. Build local
echo "[1/4] Building local..."
export PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /root/kontenpilot-ai
NODE_ENV=production npx next build
echo "✓ Local build done"

# 2. Restart local
echo "[2/4] Restarting local service..."
sudo systemctl restart kontenpilot-backend.service
sleep 2
if systemctl is-active --quiet kontenpilot-backend.service; then
  echo "✓ Local service running"
else
  echo "✗ Local service FAILED"
  exit 1
fi

# 3. Sync ke server baru
echo "[3/4] Syncing to 202.10.41.72..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude data \
  --exclude .env \
  /root/kontenpilot-ai/ \
  admin@202.10.41.72:/home/admin/kontenpilot-ai/
echo "✓ Files synced"

# 4. Build + restart server baru
echo "[4/4] Building + restarting 202.10.41.72..."
ssh admin@202.10.41.72 '
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm use 20
  echo "Using node: $(which node) ($(node --version))"
  
  cd /home/admin/kontenpilot-ai
  
  # Install deps kalau belum ada
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  
  npx next build
  sudo systemctl restart kontenpilot-backend.service
  sleep 2
  if systemctl is-active --quiet kontenpilot-backend.service; then
    echo "✓ Server baru service running"
  else
    echo "✗ Server baru service FAILED"
    exit 1
  fi
'

echo ""
echo "=== Deploy selesai ==="
echo "Local:        http://localhost:3100"
echo "Server baru:  http://202.10.41.72:3100"
