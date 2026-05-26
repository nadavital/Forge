#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/ensure-local-runtime-secrets.sh [--env-file PATH]

Creates or updates the local dashboard env file with missing runtime secrets.
Existing non-empty values are preserved and generated secret values are never printed.

Generated when missing:
  FORGE_PIPELINE_WORKER_SECRET
  GITHUB_STATE_SECRET
  FORGE_TOKEN_ENCRYPTION_KEY
USAGE
}

env_file="apps/dashboard/.env.local"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --env-file)
      env_file="${2:-}"
      shift 2
      ;;
    --env-file=*)
      env_file="${1#--env-file=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_path="$repo_root/$env_file"
example_path="$repo_root/apps/dashboard/.env.local.example"

if [[ ! -f "$env_path" ]]; then
  if [[ ! -f "$example_path" ]]; then
    echo "Missing env file and example: $env_path" >&2
    exit 2
  fi
  mkdir -p "$(dirname "$env_path")"
  cp "$example_path" "$env_path"
  echo "Created $env_file from apps/dashboard/.env.local.example"
fi

ensure_secret() {
  local key="$1"
  local current
  current="$(grep -E "^${key}=" "$env_path" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -n "${current//[[:space:]]/}" ]]; then
    echo "Preserved existing $key"
    return
  fi

  local value
  value="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  local tmp
  tmp="$(mktemp)"

  if grep -q -E "^${key}=" "$env_path"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { updated = 0 }
      $0 ~ "^" key "=" {
        if (updated == 0) {
          print key "=" value
          updated = 1
        } else {
          print
        }
        next
      }
      { print }
    ' "$env_path" > "$tmp"
  else
    cp "$env_path" "$tmp"
    {
      echo ""
      echo "${key}=${value}"
    } >> "$tmp"
  fi

  mv "$tmp" "$env_path"
  echo "Generated $key"
}

ensure_secret "FORGE_PIPELINE_WORKER_SECRET"
ensure_secret "GITHUB_STATE_SECRET"
ensure_secret "FORGE_TOKEN_ENCRYPTION_KEY"

echo "Local runtime secrets are present in $env_file"
