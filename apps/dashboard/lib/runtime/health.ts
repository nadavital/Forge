import { createHmac } from "node:crypto";
import { createSupabaseClient } from "../db/supabase.ts";
import type { ForgeStore } from "../db/types.ts";
import { checkGitHubAppConfiguration } from "../github/github-app.ts";
import { authContextFromBearerToken, getRequestAuthContext } from "../auth/request-session.ts";
import { hostedBriefResearchRequiresManagedBackend } from "../research/managed-research-policy.ts";
import { forcedLocalStorage, runtimeReadiness, type RuntimeReadinessItem } from "./readiness.ts";

export type RuntimeHealthStatus = "ok" | "warning" | "error" | "skipped";

export type RuntimeHealthResult = {
  checkedAt: string;
  items: Array<{
    id: string;
    label: string;
    status: RuntimeHealthStatus;
    summary: string;
    detail?: string;
  }>;
};

type Env = Partial<Record<string, string | undefined>>;

type RuntimeHealthOptions = {
  env?: Env;
  fetchImpl?: typeof fetch;
  authBearerToken?: string | null;
};

const REQUIRED_SUPABASE_PROBES: Array<{ table: keyof ForgeStore; query: string }> = [
  { table: "users", query: "select=id,email,display_name&limit=1" },
  { table: "workspaces", query: "select=id,name,owner_user_id&limit=1" },
  { table: "workspace_members", query: "select=workspace_id,user_id,role&limit=1" },
  { table: "user_auth_identities", query: "select=id,user_id,provider,subject&limit=1" },
  { table: "projects", query: "select=id,owner_user_id,workspace_id,mode,repo_url&limit=1" },
  { table: "github_connections", query: "select=id,owner_user_id,workspace_id,provider,installation_id,status&limit=1" },
  { table: "github_user_tokens", query: "select=id,connection_id,owner_user_id,token_type,expires_at,refresh_token_expires_at&limit=1" },
  { table: "source_configs", query: "select=id,project_id,connection_id,source_type,status&limit=1" },
  { table: "triggers", query: "select=id,project_id,trigger_type,status,last_run_at&limit=1" },
  { table: "user_preferences", query: "select=id,project_id,preferred_markets,risk_tolerance&limit=1" },
  { table: "preference_events", query: "select=id,project_id,opportunity_id,mvp_build_id,event_type&limit=1" },
  { table: "pipeline_runs", query: "select=id,project_id,research_brief_id,status,metadata&limit=1" },
  { table: "idea_conversations", query: "select=id,project_id,user_id,status&limit=1" },
  { table: "idea_messages", query: "select=id,conversation_id,role,metadata&limit=1" },
  { table: "research_briefs", query: "select=id,project_id,conversation_id,status,hypothesis&limit=1" },
  { table: "agent_tasks", query: "select=id,project_id,pipeline_run_id,research_brief_id,agent_role,status&limit=1" },
  { table: "signals", query: "select=id,project_id,source,title,url&limit=1" },
  { table: "opportunities", query: "select=id,project_id,pipeline_run_id,status,profile&limit=1" },
  { table: "opportunity_signals", query: "select=opportunity_id,signal_id&limit=1" },
  { table: "opportunity_evaluations", query: "select=id,opportunity_id,evaluator,scores&limit=1" },
  { table: "prototype_options", query: "select=id,project_id,opportunity_id,prototype_type,status&limit=1" },
  { table: "mvp_builds", query: "select=id,project_id,opportunity_id,status,build_brief&limit=1" },
  { table: "build_artifacts", query: "select=id,mvp_build_id,artifact_type,metadata&limit=1" },
  { table: "reflection_runs", query: "select=id,project_id,status,evidence&limit=1" },
  { table: "reflection_proposals", query: "select=id,reflection_run_id,proposal_type,status&limit=1" }
];

export async function checkRuntimeHealth(options: RuntimeHealthOptions = {}): Promise<RuntimeHealthResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const readiness = runtimeReadiness(env);
  const items = await Promise.all(readiness.map((item) => checkRuntimeHealthItem(item, env, fetchImpl, options.authBearerToken)));
  return {
    checkedAt: new Date().toISOString(),
    items
  };
}

async function checkRuntimeHealthItem(
  item: RuntimeReadinessItem,
  env: Env,
  fetchImpl: typeof fetch,
  authBearerToken?: string | null
): Promise<RuntimeHealthResult["items"][number]> {
  if (item.id === "managed_research") {
    return checkManagedResearch(item, env, fetchImpl);
  }
  if (item.id === "pipeline_worker") {
    return checkPipelineWorker(item, env, fetchImpl);
  }
  if (item.id === "github_app") {
    return checkGitHubApp(item, env, fetchImpl);
  }
  if (item.id === "storage") {
    return checkStorage(item, env);
  }
  if (item.id === "user_session") {
    return checkUserSession(item, env, fetchImpl, authBearerToken);
  }
  if (item.id === "ai_intake") {
    return item.missing.length
      ? skipped(item, "GEMINI_API_KEY is missing; AI brief compilation will not run.")
      : ok(item, "GEMINI_API_KEY is present. Live model calls are exercised by idea intake, not by this check.");
  }
  if (item.id === "managed_builder") {
    return item.missing.length
      ? warning(item, `Managed build path is incomplete: missing ${item.missing.join(", ")}.`)
      : ok(item, "Managed builder configuration is present. Build approval is the live end-to-end check.");
  }
  return item.missing.length ? skipped(item, item.summary) : ok(item, item.summary);
}

async function checkPipelineWorker(
  item: RuntimeReadinessItem,
  env: Env,
  fetchImpl: typeof fetch
): Promise<RuntimeHealthResult["items"][number]> {
  const secret = cleanEnv(env.FORGE_PIPELINE_WORKER_SECRET) ?? cleanEnv(env.CRON_SECRET);
  if (!secret) {
    return skipped(item, "FORGE_PIPELINE_WORKER_SECRET or CRON_SECRET is missing.");
  }
  const appUrl = cleanEnv(env.FORGE_PUBLIC_APP_URL)?.replace(/\/$/, "");
  if (!appUrl) {
    return warning(item, "Worker secret is configured, but FORGE_PUBLIC_APP_URL is missing so the endpoint was not checked.");
  }

  try {
    const timeoutMs = Number(env.FORGE_PIPELINE_WORKER_HEALTH_TIMEOUT_MS || 5000);
    const response = await fetchImpl(`${appUrl}/api/pipeline/worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ probe: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.text();
    if (!response.ok) {
      return error(item, `Pipeline worker probe returned ${response.status}.`, healthDetail(body, env));
    }
    return ok(item, "Pipeline worker endpoint accepted the bearer probe.", safeJsonStatus(body, env));
  } catch (reason) {
    return error(item, "Pipeline worker endpoint could not be reached.", errorMessage(reason, env));
  }
}

async function checkManagedResearch(
  item: RuntimeReadinessItem,
  env: Env,
  fetchImpl: typeof fetch
): Promise<RuntimeHealthResult["items"][number]> {
  const baseUrl = cleanEnv(env.FORGE_MANAGED_RESEARCH_URL)?.replace(/\/$/, "");
  if (!baseUrl) {
    if (hostedBriefResearchRequiresManagedBackend(env)) {
      return error(
        item,
        "FORGE_MANAGED_RESEARCH_URL is missing; hosted brief research cannot run source-backed agents."
      );
    }
    return skipped(item, "FORGE_MANAGED_RESEARCH_URL is missing.");
  }
  if (hostedBriefResearchRequiresManagedBackend(env) && !cleanEnv(env.FORGE_MANAGED_RESEARCH_SECRET)) {
    return error(
      item,
      "FORGE_MANAGED_RESEARCH_SECRET is missing; hosted brief research cannot call the managed backend."
    );
  }

  try {
    const timeoutMs = Number(env.FORGE_MANAGED_RESEARCH_HEALTH_TIMEOUT_MS || 5000);
    const response = await fetchImpl(`${baseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.text();
    if (!response.ok) {
      return error(item, `Managed research /health returned ${response.status}.`, healthDetail(body, env));
    }
    return ok(item, "Managed research /health responded.", safeJsonStatus(body, env));
  } catch (reason) {
    return error(item, "Managed research /health could not be reached.", errorMessage(reason, env));
  }
}

async function checkGitHubApp(
  item: RuntimeReadinessItem,
  env: Env,
  fetchImpl: typeof fetch
): Promise<RuntimeHealthResult["items"][number]> {
  if (item.missing.includes("GITHUB_APP_ID") || item.missing.includes("GITHUB_APP_PRIVATE_KEY")) {
    return skipped(item, "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required before GitHub can be checked.");
  }

  try {
    const app = await checkGitHubAppConfiguration(env);
    const appName = app.slug || app.name || app.owner || "GitHub App";
    const permissionWarnings = githubAppPermissionWarnings(app.permissions ?? {});
    const webhookProbe = await checkGitHubWebhookPing(item, env, fetchImpl);
    const webhookWarning = webhookProbe.status === "ok" ? null : webhookProbe.summary;
    const warningDetails = [
      ...permissionWarnings,
      webhookWarning ? [webhookWarning, webhookProbe.detail].filter(Boolean).join(" ") : null
    ].filter((detail): detail is string => Boolean(detail));

    if (item.missing.length) {
      return warning(item, `${appName} credentials are valid, but missing ${item.missing.join(", ")}.`);
    }
    if (permissionWarnings.length || webhookWarning) {
      return warning(
        item,
        permissionWarnings.length
          ? `${appName} credentials are valid, but GitHub App permissions are incomplete.`
          : `${appName} credentials are valid, but the webhook route was not proved.`,
        warningDetails.join(" ")
      );
    }
    return ok(item, `${appName} credentials are valid. Signed webhook ping was accepted.`, webhookProbe.detail);
  } catch (reason) {
    return error(item, "GitHub App credentials could not be validated.", errorMessage(reason, env));
  }
}

async function checkGitHubWebhookPing(
  item: RuntimeReadinessItem,
  env: Env,
  fetchImpl: typeof fetch
): Promise<RuntimeHealthResult["items"][number]> {
  const secret = cleanEnv(env.GITHUB_WEBHOOK_SECRET);
  if (!secret) {
    return warning(item, "GITHUB_WEBHOOK_SECRET is missing; webhook signature verification cannot be checked.");
  }
  const appUrl = cleanEnv(env.FORGE_PUBLIC_APP_URL)?.replace(/\/$/, "");
  if (!appUrl) {
    return warning(item, "FORGE_PUBLIC_APP_URL is missing, so the signed webhook route was not checked.");
  }

  const body = JSON.stringify({
    zen: "Forge runtime webhook probe",
    hook_id: 0
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  try {
    const timeoutMs = Number(env.FORGE_GITHUB_WEBHOOK_HEALTH_TIMEOUT_MS || 5000);
    const response = await fetchImpl(`${appUrl}/api/github/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "forge-runtime-smoke",
        "X-GitHub-Event": "ping",
        "X-Hub-Signature-256": `sha256=${signature}`
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const responseBody = await response.text();
    if (response.status !== 202) {
      return warning(item, `Signed webhook ping returned ${response.status}.`, healthDetail(responseBody, env));
    }
    return ok(item, "Signed webhook ping was accepted.", safeJsonStatus(responseBody, env));
  } catch (reason) {
    return warning(item, "Signed webhook ping could not reach /api/github/webhook.", errorMessage(reason, env));
  }
}

function githubAppPermissionWarnings(permissions: Record<string, string>): string[] {
  const warnings: string[] = [];
  if (permissions.contents !== "write") {
    warnings.push("Contents write permission is required for server-side PR branches and generated MVP file commits.");
  }
  if (!["read", "write"].includes(permissions.issues || "")) {
    warnings.push("Issues read permission is required for connected-product issue evidence.");
  }
  if (permissions.administration !== "write") {
    warnings.push("Administration write permission is required only when organization installations should create generated repos.");
  }
  return warnings;
}

async function checkStorage(
  item: RuntimeReadinessItem,
  env: Env
): Promise<RuntimeHealthResult["items"][number]> {
  if (forcedLocalStorage(env)) {
    return warning(
      item,
      "FORGE_STORAGE_BACKEND=local is active; hosted Supabase storage was not checked.",
      "Unset FORGE_STORAGE_BACKEND before using runtime smoke as hosted storage proof."
    );
  }

  if (!cleanEnv(env.SUPABASE_URL) || !cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY)) {
    return warning(item, "Supabase is not configured; Forge is using the local JSON store.");
  }
  const client = createSupabaseClient();
  if (!client) {
    return warning(item, "Supabase is not configured; Forge is using the local JSON store.");
  }

  try {
    for (const probe of REQUIRED_SUPABASE_PROBES) {
      await client.select(probe.table, probe.query);
    }
    return ok(
      item,
      "Supabase schema check succeeded for server-side storage.",
      `${REQUIRED_SUPABASE_PROBES.length} required table/column probes responded.`
    );
  } catch (reason) {
    const message = errorMessage(reason, env);
    return error(item, storageFailureSummary(message), storageFailureDetail(message, env));
  }
}

async function checkUserSession(
  item: RuntimeReadinessItem,
  env: Env,
  fetchImpl: typeof fetch,
  authBearerToken?: string | null
): Promise<RuntimeHealthResult["items"][number]> {
  if (!cleanEnv(env.SUPABASE_URL) || !cleanEnv(env.SUPABASE_ANON_KEY)) {
    return warning(item, "Supabase Auth request-session validation is not configured.");
  }
  if (!cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY)) {
    return warning(item, "Supabase Auth can validate users, but service-role storage writes are not configured.");
  }

  const cleanBearerToken = authBearerToken?.trim();
  const context = cleanBearerToken
    ? await authContextFromBearerToken(cleanBearerToken, "authorization_header", env, fetchImpl)
    : await getRequestAuthContext(env);
  if (!context) {
    return warning(item, "Session auth is configured, but this health request did not include a valid Supabase Auth session.");
  }
  return ok(item, "Supabase Auth session validated for the current request.", `source=${context.tokenSource}`);
}

function ok(item: RuntimeReadinessItem, summary: string, detail?: string): RuntimeHealthResult["items"][number] {
  return { id: item.id, label: item.label, status: "ok", summary, detail };
}

function warning(item: RuntimeReadinessItem, summary: string, detail?: string): RuntimeHealthResult["items"][number] {
  return { id: item.id, label: item.label, status: "warning", summary, detail };
}

function error(item: RuntimeReadinessItem, summary: string, detail?: string): RuntimeHealthResult["items"][number] {
  return { id: item.id, label: item.label, status: "error", summary, detail };
}

function skipped(item: RuntimeReadinessItem, summary: string): RuntimeHealthResult["items"][number] {
  return { id: item.id, label: item.label, status: "skipped", summary };
}

function cleanEnv(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(reason: unknown, env: Env = process.env): string {
  return redactHealthText(reason instanceof Error ? reason.message : String(reason), env);
}

function storageFailureSummary(message: string): string {
  return isMissingSupabaseSchemaError(message)
    ? "Supabase storage schema is incomplete."
    : "Supabase storage check failed.";
}

function storageFailureDetail(message: string, env: Env): string {
  if (!isMissingSupabaseSchemaError(message)) {
    return message;
  }
  const migrationCredential = cleanEnv(env.SUPABASE_DB_URL)
    ? "SUPABASE_DB_URL is configured for migration application."
    : "SUPABASE_DB_URL is not configured; service-role API keys cannot create missing tables.";
  return [
    "Missing table or column detected.",
    "Apply migrations with `pnpm supabase:migrate -- --env-file apps/dashboard/.env.local`.",
    migrationCredential,
    `Original error: ${message}`
  ].join(" ");
}

function isMissingSupabaseSchemaError(message: string): boolean {
  return /PGRST205|Could not find the table|column .* does not exist/i.test(message);
}

function healthDetail(body: string, env: Env): string {
  return redactHealthText(body.slice(0, 180), env);
}

function safeJsonStatus(body: string, env: Env): string {
  try {
    const payload = JSON.parse(body) as { status?: unknown };
    return typeof payload.status === "string"
      ? redactHealthText(`status=${payload.status}`, env)
      : "valid JSON response";
  } catch {
    return healthDetail(body, env);
  }
}

function redactHealthText(value: string, env: Env): string {
  let redacted = value;
  for (const secret of healthSecretValues(env)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  redacted = redacted.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/((?:github_)?access_token\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(refresh_token\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/((?:api_)?key\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(secret\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(token\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  return redacted;
}

function healthSecretValues(env: Env): string[] {
  const secretNamePattern = /(?:SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE|API_KEY|DB_URL|AUTH_BEARER)/i;
  return Object.entries(env)
    .filter(([name, value]) => secretNamePattern.test(name) && typeof value === "string")
    .map(([, value]) => value?.trim() ?? "")
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);
}
