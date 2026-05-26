#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/preflight-supabase-runtime.sh [--env-file PATH] [--skip-project-check]

Checks hosted Supabase runtime and migration prerequisites without printing secret values.

Required for hosted storage proof:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_ANON_KEY
  SUPABASE_DB_URL
  psql

Notes:
  - SUPABASE_DB_URL is required only for applying migrations; do not deploy it as runtime config.
  - If SUPABASE_URL is set, SUPABASE_DB_URL must include the same Supabase project ref unless --skip-project-check is passed.
  - Local editor conflict migration files matching "* 2.*" are reported as errors.
USAGE
}

env_file=""
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
    echo "[error] Env file not found: $env_file" >&2
    exit 2
  fi
  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
fi

status=0

check_present() {
  local name="$1"
  local detail="$2"
  if [[ -n "${!name:-}" ]]; then
    echo "[ok] $name is configured."
  else
    echo "[error] $name is missing. $detail"
    status=1
  fi
}

check_present "SUPABASE_URL" "Required for hosted REST, Auth, and Realtime."
check_present "SUPABASE_SERVICE_ROLE_KEY" "Required for server-side scoped storage reads and writes."
check_present "SUPABASE_ANON_KEY" "Required for browser user sessions and Supabase Realtime."
check_present "SUPABASE_DB_URL" "Required to apply schema migrations with pnpm supabase:migrate."

expected_ref=""
if [[ "${SUPABASE_URL:-}" =~ ^https?://([A-Za-z0-9-]+)\.supabase\.co/? ]]; then
  expected_ref="${BASH_REMATCH[1]}"
fi

if [[ -n "${SUPABASE_DB_URL:-}" && -n "$expected_ref" && "$skip_project_check" -eq 0 ]]; then
  if [[ "${SUPABASE_DB_URL}" == *"$expected_ref"* ]]; then
    echo "[ok] SUPABASE_DB_URL appears to target the same Supabase project ref as SUPABASE_URL."
  else
    echo "[error] SUPABASE_DB_URL does not appear to target the same Supabase project ref as SUPABASE_URL."
    echo "        Expected project ref: $expected_ref"
    status=1
  fi
elif [[ -n "${SUPABASE_DB_URL:-}" && -n "$expected_ref" ]]; then
  echo "[warn] Supabase project-ref check skipped by --skip-project-check."
elif [[ -n "${SUPABASE_URL:-}" && -z "$expected_ref" ]]; then
  echo "[warn] SUPABASE_URL is set but does not look like https://<project-ref>.supabase.co."
fi

if command -v psql >/dev/null 2>&1; then
  echo "[ok] psql is available."
else
  echo "[error] psql is missing. Install PostgreSQL client tools before applying migrations."
  status=1
fi

migration_dir="$repo_root/supabase/migrations"
if [[ ! -d "$migration_dir" ]]; then
  echo "[error] Migration directory not found: $migration_dir"
  exit 1
fi

migration_files=()
while IFS= read -r migration; do
  migration_files+=("$migration")
done < <(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' ! -name '* 2.*' | sort)

conflict_files=()
while IFS= read -r migration; do
  conflict_files+=("$migration")
done < <(find "$migration_dir" -maxdepth 1 -type f -name '* 2.*' | sort)

if [[ "${#conflict_files[@]}" -gt 0 ]]; then
  echo "[error] Found local editor conflict migration files matching '* 2.*'. Remove or rename them before applying migrations."
  status=1
else
  echo "[ok] No editor conflict migration files found."
fi

for migration in "${migration_files[@]}"; do
  name="$(basename "$migration")"
  version="${name%%_*}"
  duplicate_count=0
  for candidate in "${migration_files[@]}"; do
    candidate_name="$(basename "$candidate")"
    candidate_version="${candidate_name%%_*}"
    if [[ "$candidate_version" == "$version" ]]; then
      duplicate_count=$((duplicate_count + 1))
    fi
  done
  if [[ "$duplicate_count" -gt 1 ]]; then
    echo "[error] Duplicate migration version prefix: $version"
    status=1
  fi
done

for required in \
  "0001_core_discovery_tables.sql" \
  "0008_identity_github_idea_research_contract.sql" \
  "0009_workspace_rls_contract.sql" \
  "0010_auth_subject_identity_mapping.sql" \
  "0011_github_user_tokens.sql" \
  "0012_github_token_connection_scope.sql" \
  "0013_realtime_status_publication.sql" \
  "0014_demo_loop_contract.sql" \
  "0015_github_connections_provider_scope.sql"
do
  if [[ -f "$migration_dir/$required" ]]; then
    echo "[ok] Required migration present: $required"
  else
    echo "[error] Required migration missing: $required"
    status=1
  fi
done

if [[ "$status" -eq 0 ]]; then
  echo "Supabase hosted storage preflight passed. Next: pnpm supabase:migrate -- --env-file ${env_file:-apps/dashboard/.env.local}"
else
  echo "Supabase hosted storage preflight failed. Fix the errors above before expecting hosted runtime smoke to pass."
fi

exit "$status"
