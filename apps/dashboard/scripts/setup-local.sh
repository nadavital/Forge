#!/usr/bin/env bash
set -euo pipefail

DASHBOARD="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$DASHBOARD/../.." && pwd)"
STORE_DIR="$DASHBOARD/.forge-data"
STORE="$STORE_DIR/store.json"

mkdir -p "$STORE_DIR"
if [ ! -f "$STORE" ]; then
  printf '%s\n' '{"projects":[],"source_configs":[],"triggers":[],"user_preferences":[],"preference_events":[],"pipeline_runs":[],"signals":[],"opportunities":[],"opportunity_signals":[],"opportunity_evaluations":[],"prototype_options":[],"mvp_builds":[],"build_artifacts":[],"reflection_runs":[],"reflection_proposals":[]}' > "$STORE"
fi
echo "Prepared local Forge store at $STORE"

cd "$ROOT"
pnpm install --filter @forge/dashboard...

echo ""
echo "Forge dashboard is ready."
echo "  pnpm dev     → http://localhost:3000"
echo ""
echo "Optional (when backend is live): copy apps/dashboard/.env.local.example to .env.local"
