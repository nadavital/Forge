import type { RuntimeHealthResult, RuntimeHealthStatus } from "./health.ts";
import { runtimeSetupReferences, type RuntimeSetupReference } from "./setup.ts";

type Env = Partial<Record<string, string | undefined>>;

export type RuntimeHandoffAction = {
  id: string;
  title: string;
  detail: string;
  setup?: RuntimeSetupReference[];
  commands?: string[];
};

const COMMANDS = {
  preflight: "pnpm supabase:preflight -- --env-file apps/dashboard/.env.local",
  migrate: "pnpm supabase:migrate -- --env-file apps/dashboard/.env.local",
  smoke: "pnpm smoke:runtime",
  strictSmoke: "FORGE_SMOKE_AUTH_BEARER=<supabase-access-token> pnpm smoke:runtime -- --strict"
};

export function buildRuntimeHandoff(result: RuntimeHealthResult, env: Env = process.env): RuntimeHandoffAction[] {
  const byId = new Map(result.items.map((item) => [item.id, item]));
  const actions: RuntimeHandoffAction[] = [];

  const storage = byId.get("storage");
  if (storage && needsAction(storage)) {
    actions.push({
      id: "hosted_storage",
      title: "Prove hosted Supabase storage",
      detail: storageHandoffDetail(storage, env),
      commands: [COMMANDS.preflight, COMMANDS.migrate, COMMANDS.smoke]
    });
  }

  const userSession = byId.get("user_session");
  if (userSession && needsAction(userSession)) {
    actions.push({
      id: "hosted_auth",
      title: "Prove signed-in user scope",
      detail: "Enable Supabase Auth for the hosted project, set SUPABASE_ANON_KEY and FORGE_REQUIRE_AUTH=1 in hosted runtime config, sign in through /login, then rerun strict smoke with a real Supabase access token.",
      setup: runtimeSetupReferences("user_session", env),
      commands: [COMMANDS.strictSmoke]
    });
  }

  const managedResearch = byId.get("managed_research");
  if (managedResearch && needsAction(managedResearch)) {
    actions.push({
      id: "managed_research",
      title: "Connect the managed research service",
      detail: "Deploy or start the managed research service, set FORGE_MANAGED_RESEARCH_URL and FORGE_MANAGED_RESEARCH_SECRET in the dashboard runtime, and verify /health before approving hosted research briefs.",
      commands: [COMMANDS.smoke]
    });
  }

  const pipelineWorker = byId.get("pipeline_worker");
  if (pipelineWorker && needsAction(pipelineWorker)) {
    actions.push({
      id: "pipeline_worker",
      title: "Prove queued research processing",
      detail: "Set FORGE_PUBLIC_APP_URL plus FORGE_PIPELINE_WORKER_SECRET or CRON_SECRET, configure the hosted cron/job caller with the same bearer secret, and rerun smoke so the probe reaches /api/pipeline/worker.",
      setup: runtimeSetupReferences("pipeline_worker", env),
      commands: [COMMANDS.smoke]
    });
  }

  const githubApp = byId.get("github_app");
  if (githubApp && needsAction(githubApp)) {
    actions.push({
      id: "github_app",
      title: "Finish the real GitHub connection path",
      detail: "Create or update the GitHub App, configure GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG, GITHUB_WEBHOOK_SECRET, and FORGE_PUBLIC_APP_URL for signed webhook proof, then install it on the target account with contents:write and issue-read permissions. Add administration:write only when organization generated-repo creation must be supported.",
      setup: runtimeSetupReferences("github_app", env),
      commands: [COMMANDS.smoke]
    });
  }

  const managedBuilder = byId.get("managed_builder");
  if (managedBuilder && needsAction(managedBuilder)) {
    actions.push({
      id: "managed_builder",
      title: "Make managed builds PR-capable",
      detail: "Configure GEMINI_API_KEY, FORGE_TEMPLATE_REPO_URL, FORGE_GENERATED_REPO_OWNER, GitHub App user OAuth client credentials, a signed callback state secret, and FORGE_TOKEN_ENCRYPTION_KEY for hosted token storage, then link a project generated-repo target.",
      setup: runtimeSetupReferences("managed_builder", env),
      commands: [COMMANDS.smoke]
    });
  }

  return actions;
}

export function formatRuntimeHandoff(actions: RuntimeHandoffAction[]): string {
  if (actions.length === 0) {
    return "Hosted runtime handoff: no follow-up actions detected.";
  }

  const lines = ["Hosted setup next actions:"];
  actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.title}`);
    lines.push(`   ${action.detail}`);
    for (const setup of action.setup ?? []) {
      const proof = setup.proof ? ` (${setup.proof.notProvedLabel})` : "";
      lines.push(`   - ${setup.label}: ${setup.value}${proof}`);
    }
    for (const command of action.commands ?? []) {
      lines.push(`   - ${command}`);
    }
  });
  return lines.join("\n");
}

function needsAction(item: RuntimeHealthResult["items"][number] | undefined): boolean {
  if (!item) return false;
  return actionStatuses.has(item.status);
}

const actionStatuses = new Set<RuntimeHealthStatus>(["warning", "error", "skipped"]);

function storageHandoffDetail(item: RuntimeHealthResult["items"][number], env: Env): string {
  const forcedLocal = cleanEnv(env.FORGE_STORAGE_BACKEND)?.toLowerCase() === "local";
  if (forcedLocal) {
    return "Unset FORGE_STORAGE_BACKEND for hosted proof, keep SUPABASE_DB_URL only in local operator env, then preflight and apply the schema migrations before rerunning runtime smoke.";
  }

  const text = `${item.summary} ${item.detail ?? ""}`;
  if (/schema is incomplete|missing table|missing column|PGRST205/i.test(text)) {
    return /SUPABASE_DB_URL is not configured/i.test(text)
      ? "Set a local-only SUPABASE_DB_URL for the same Supabase project, run preflight, then apply the pending migrations before rerunning runtime smoke."
      : "Run the Supabase preflight, apply the pending migrations with the configured SUPABASE_DB_URL, then rerun runtime smoke.";
  }

  return "Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, and a local-only SUPABASE_DB_URL, then preflight and apply migrations before treating storage as hosted.";
}

function cleanEnv(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
