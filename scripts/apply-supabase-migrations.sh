#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/apply-supabase-migrations.sh [--env-file PATH] [--dry-run] [--skip-project-check]

Applies Forge's Supabase SQL migrations directly with psql.

Required:
  SUPABASE_DB_URL   Postgres connection string for the target Supabase database.

Notes:
  - SUPABASE_SERVICE_ROLE_KEY is not enough to apply schema migrations.
  - If SUPABASE_URL is set, SUPABASE_DB_URL must include the same Supabase project ref.
  - Local editor conflict files matching "* 2.*" are ignored.
  - Migrations are written to be idempotent; the script stops on the first SQL error.
USAGE
}

env_file=""
dry_run=0
skip_project_check=0

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
    --dry-run)
      dry_run=1
      shift
      ;;
    --skip-project-check)
      skip_project_check=1
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

if [[ -n "$env_file" ]]; then
  if [[ ! -f "$env_file" ]]; then
    echo "Env file not found: $env_file" >&2
    exit 2
  fi
  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is required. Use the hosted database connection string, not the service-role API key." >&2
  exit 2
fi

expected_ref=""
if [[ "${SUPABASE_URL:-}" =~ ^https?://([A-Za-z0-9-]+)\.supabase\.co/? ]]; then
  expected_ref="${BASH_REMATCH[1]}"
fi

if [[ -n "$expected_ref" && "$skip_project_check" -eq 0 ]]; then
  if [[ "${SUPABASE_DB_URL}" != *"$expected_ref"* ]]; then
    cat >&2 <<EOF
SUPABASE_DB_URL does not appear to target the same Supabase project as SUPABASE_URL.
Expected project ref: $expected_ref

Use the database connection string for that project, or rerun with --skip-project-check only after manually verifying the target.
EOF
    exit 2
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to apply migrations." >&2
  exit 2
fi

migration_dir="$repo_root/supabase/migrations"
if [[ ! -d "$migration_dir" ]]; then
  echo "Migration directory not found: $migration_dir" >&2
  exit 2
fi

echo "Applying Forge Supabase migrations from $migration_dir"
find "$migration_dir" -maxdepth 1 -type f -name '*.sql' ! -name '* 2.*' | sort | while IFS= read -r migration; do
  name="$(basename "$migration")"
  if [[ "$dry_run" -eq 1 ]]; then
    echo "[dry-run] $name"
    continue
  fi
  echo "[apply] $name"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

if [[ "$dry_run" -eq 1 ]]; then
  echo "Dry run complete. No SQL was applied."
else
  echo "Supabase migrations applied."
fi
