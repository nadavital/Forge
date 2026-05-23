#!/usr/bin/env bash
set -euo pipefail

DASHBOARD="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$DASHBOARD/../.." && pwd)"
SEED="$DASHBOARD/data/seed.json"
STORE_DIR="$DASHBOARD/.forge-data"
STORE="$STORE_DIR/store.json"

mkdir -p "$STORE_DIR"
cp "$SEED" "$STORE"
echo "Seeded local Forge store at $STORE"

cd "$ROOT"
pnpm install --filter @forge/dashboard...

echo ""
echo "Forge dashboard is ready."
echo "  pnpm dev     → http://localhost:3000"
echo "  Demo project: Acme Console → API key recovery opportunity"
echo ""
echo "Optional (when backend is live): copy apps/dashboard/.env.local.example to .env.local"
