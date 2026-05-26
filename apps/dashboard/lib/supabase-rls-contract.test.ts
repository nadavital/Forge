import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/0009_workspace_rls_contract.sql", import.meta.url),
  "utf8"
);
const baselineMigration = readFileSync(
  new URL("../../../supabase/migrations/0001_core_discovery_tables.sql", import.meta.url),
  "utf8"
);
const opportunityStatusMigration = readFileSync(
  new URL("../../../supabase/migrations/0003_opportunity_status_contract.sql", import.meta.url),
  "utf8"
);
const authMappingMigration = readFileSync(
  new URL("../../../supabase/migrations/0010_auth_subject_identity_mapping.sql", import.meta.url),
  "utf8"
);
const githubUserTokensMigration = readFileSync(
  new URL("../../../supabase/migrations/0011_github_user_tokens.sql", import.meta.url),
  "utf8"
);
const githubTokenConnectionScopeMigration = readFileSync(
  new URL("../../../supabase/migrations/0012_github_token_connection_scope.sql", import.meta.url),
  "utf8"
);
const realtimePublicationMigration = readFileSync(
  new URL("../../../supabase/migrations/0013_realtime_status_publication.sql", import.meta.url),
  "utf8"
);
const migrationFiles = readdirSync(new URL("../../../supabase/migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql") && !name.includes(" 2."))
  .sort();
const migrationScript = readFileSync(
  new URL("../../../scripts/apply-supabase-migrations.sh", import.meta.url),
  "utf8"
);
const supabasePreflightScript = readFileSync(
  new URL("../../../scripts/preflight-supabase-runtime.sh", import.meta.url),
  "utf8"
);
const localSecretsScript = readFileSync(
  new URL("../../../scripts/ensure-local-runtime-secrets.sh", import.meta.url),
  "utf8"
);
const rlsMigrations = [migration, authMappingMigration, githubUserTokensMigration, githubTokenConnectionScopeMigration].join("\n");
const hostedRuntimeTables = [
  "users",
  "workspaces",
  "workspace_members",
  "user_auth_identities",
  "projects",
  "github_connections",
  "github_user_tokens",
  "source_configs",
  "triggers",
  "user_preferences",
  "preference_events",
  "pipeline_runs",
  "idea_conversations",
  "idea_messages",
  "research_briefs",
  "agent_tasks",
  "signals",
  "opportunities",
  "opportunity_signals",
  "opportunity_evaluations",
  "prototype_options",
  "mvp_builds",
  "build_artifacts",
  "reflection_runs",
  "reflection_proposals",
  "project_schedules",
  "project_source_configs",
  "project_runs",
  "opportunity_actions"
];

test("baseline migration creates discovery tables before later migrations reference them", () => {
  for (const table of [
    "projects",
    "pipeline_runs",
    "signals",
    "opportunities",
    "opportunity_signals",
    "opportunity_evaluations"
  ]) {
    assert.match(baselineMigration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(baselineMigration, /pipeline_run_id uuid references public\.pipeline_runs\(id\)/);
  assert.match(baselineMigration, /opportunity_id uuid not null references public\.opportunities\(id\)/);
});

test("hosted migrations have unique ordered version prefixes", () => {
  const versions = migrationFiles.map((name) => name.split("_")[0]);
  assert.equal(new Set(versions).size, versions.length);
  assert.ok(migrationFiles.indexOf("0005_dashboard_runtime_tables.sql") < migrationFiles.indexOf("0014_demo_loop_contract.sql"));
});

test("migration helper checks Supabase DB URL target before applying SQL", () => {
  assert.match(migrationScript, /SUPABASE_DB_URL is required/);
  assert.match(migrationScript, /SUPABASE_URL.*supabase.*co/);
  assert.match(migrationScript, /Expected project ref/);
  assert.match(migrationScript, /--skip-project-check/);
  assert.match(migrationScript, /psql "\$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "\$migration"/);
});

test("Supabase preflight reports hosted storage prerequisites without printing secrets", () => {
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL"]) {
    assert.match(supabasePreflightScript, new RegExp(`check_present "${key}"`));
  }
  assert.match(supabasePreflightScript, /Expected project ref/);
  assert.match(supabasePreflightScript, /command -v psql/);
  assert.doesNotMatch(supabasePreflightScript, /mapfile/);
  assert.doesNotMatch(supabasePreflightScript, /declare -A/);
  assert.match(supabasePreflightScript, /name '\* 2\.\*'/);
  assert.match(supabasePreflightScript, /0008_identity_github_idea_research_contract\.sql/);
  assert.match(supabasePreflightScript, /0014_demo_loop_contract\.sql/);
  assert.doesNotMatch(supabasePreflightScript, /echo "\$\{?SUPABASE_(SERVICE_ROLE_KEY|ANON_KEY|DB_URL)/);
});

test("local runtime secret helper preserves existing values and generates missing secrets", () => {
  for (const key of ["FORGE_PIPELINE_WORKER_SECRET", "GITHUB_STATE_SECRET", "FORGE_TOKEN_ENCRYPTION_KEY"]) {
    assert.match(localSecretsScript, new RegExp(`ensure_secret "${key}"`));
  }
  assert.match(localSecretsScript, /Preserved existing \$key/);
  assert.match(localSecretsScript, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.doesNotMatch(localSecretsScript, /echo "\$\{?value/);
});

test("workspace RLS migration defines identity helper functions", () => {
  assert.match(migration, /create or replace function public\.forge_current_user_id\(\)/);
  assert.match(migration, /create or replace function public\.forge_can_access_workspace/);
  assert.match(migration, /create or replace function public\.forge_can_access_project/);
});

test("auth subject mapping migration separates hosted auth subjects from Forge user ids", () => {
  assert.match(authMappingMigration, /create table if not exists public\.user_auth_identities/);
  assert.match(authMappingMigration, /unique\(provider, subject\)/);
  assert.match(authMappingMigration, /create or replace function public\.forge_current_auth_subject\(\)/);
  assert.match(authMappingMigration, /select coalesce\(/);
  assert.match(authMappingMigration, /identity\.user_id/);
});

test("GitHub user token migration keeps OAuth tokens owner-scoped", () => {
  assert.match(githubUserTokensMigration, /create table if not exists public\.github_user_tokens/);
  assert.match(githubUserTokensMigration, /access_token text not null/);
  assert.match(githubUserTokensMigration, /refresh_token text/);
  assert.match(githubUserTokensMigration, /alter table public\.github_user_tokens enable row level security;/);
  assert.match(githubUserTokensMigration, /owner_user_id = public\.forge_current_user_id\(\)/);
});

test("GitHub user token policy requires the token connection to belong to the current user", () => {
  assert.match(githubTokenConnectionScopeMigration, /drop policy if exists forge_github_user_tokens_owner_access/);
  assert.match(githubTokenConnectionScopeMigration, /from public\.github_connections connection/);
  assert.match(githubTokenConnectionScopeMigration, /connection\.id = connection_id/);
  assert.match(githubTokenConnectionScopeMigration, /connection\.owner_user_id = public\.forge_current_user_id\(\)/);
});

test("workspace RLS migration enables policies for core scoped tables", () => {
  for (const table of [
    "projects",
    "github_connections",
    "source_configs",
    "pipeline_runs",
    "signals",
    "opportunities",
    "mvp_builds",
    "idea_conversations",
    "research_briefs",
    "agent_tasks"
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
});

test("hosted RLS contract covers every current runtime table", () => {
  for (const table of hostedRuntimeTables) {
    assert.match(
      rlsMigrations,
      new RegExp(`alter table public\\.${table} enable row level security;`),
      `expected ${table} to enable RLS`
    );
    assert.match(
      rlsMigrations,
      new RegExp(`create policy [\\s\\S]+ on public\\.${table}\\b`),
      `expected ${table} to have at least one explicit RLS policy`
    );
  }
});

test("workspace RLS migration avoids broad allow-all policies", () => {
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migration, /with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(authMappingMigration, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(authMappingMigration, /with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(githubUserTokensMigration, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(githubUserTokensMigration, /with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(githubTokenConnectionScopeMigration, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(githubTokenConnectionScopeMigration, /with check\s*\(\s*true\s*\)/i);
});

test("realtime publication includes only project-scoped status tables", () => {
  assert.match(realtimePublicationMigration, /pubname = 'supabase_realtime'/);
  for (const table of [
    "pipeline_runs",
    "idea_conversations",
    "research_briefs",
    "agent_tasks",
    "opportunities",
    "prototype_options",
    "mvp_builds",
    "reflection_runs"
  ]) {
    assert.match(realtimePublicationMigration, new RegExp(`'${table}'`));
  }
  assert.doesNotMatch(realtimePublicationMigration, /github_user_tokens/);
  assert.doesNotMatch(realtimePublicationMigration, /build_artifacts/);
});

test("hosted opportunity status constraint accepts dashboard-written statuses", () => {
  for (const status of ["proposed", "watching", "researching", "rejected", "approved", "building", "built"]) {
    assert.match(opportunityStatusMigration, new RegExp(`'${status}'`));
  }
});
