export type RuntimeReadinessStatus = "ready" | "partial" | "missing";

import { githubTokenFallbackEnabled } from "../github/token-fallback.ts";
import { hostedBriefResearchRequiresManagedBackend } from "../research/managed-research-policy.ts";
import { runtimePublicAppUrl, runtimeSetupReferences, type RuntimeSetupReference } from "./setup.ts";

export type RuntimeReadinessItem = {
  id: string;
  label: string;
  status: RuntimeReadinessStatus;
  summary: string;
  detail: string;
  missing: string[];
  setup: RuntimeSetupReference[];
};

type Env = Partial<Record<string, string | undefined>>;

export function runtimeReadiness(env: Env = process.env): RuntimeReadinessItem[] {
  return [
    capability({
      id: "ai_intake",
      label: "AI intake",
      required: ["GEMINI_API_KEY"],
      readySummary: "Idea conversations and repo analysis can use Gemini.",
      missingSummary: "Conversation messages are stored, but Forge cannot compile AI briefs yet.",
      detail: "Enables AI-led idea intake, research-brief compilation, and Gemini repo analysis.",
      env
    }),
    managedResearchReadiness(env),
    pipelineWorkerReadiness(env),
    gitHubAppReadiness(env),
    managedBuilderReadiness(env),
    userSessionReadiness(env),
    storageReadiness(env)
  ];
}

function managedResearchReadiness(env: Env): RuntimeReadinessItem {
  const hostedRequiresBackend = hostedBriefResearchRequiresManagedBackend(env);
  const allowUnauthenticated =
    !hostedRequiresBackend &&
    ["1", "true", "yes"].includes((env.FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH || "").toLowerCase());
  const required = [
    "FORGE_MANAGED_RESEARCH_URL",
    ...(allowUnauthenticated ? [] : ["FORGE_MANAGED_RESEARCH_SECRET"])
  ];
  const missing = required.filter((name) => !hasEnv(env, name));
  return {
    id: "managed_research",
    label: "Managed research",
    status: missing.length ? "missing" : "ready",
    summary: missing.length
      ? hostedRequiresBackend
        ? "Hosted approved-brief research is blocked until the managed backend is configured."
        : "Approved briefs queue agent tasks and wait for the managed backend."
      : "Approved briefs can call the managed research service with bearer authorization.",
    detail: allowUnauthenticated
      ? "Runs public-source collection and role-shaped research output after a brief is approved. Unauthenticated API mode is explicitly enabled for local throwaway development."
      : "Runs public-source collection and role-shaped research output after a brief is approved. The managed research service requires FORGE_MANAGED_RESEARCH_SECRET for every /api route.",
    missing,
    setup: runtimeSetupReferences("managed_research", env)
  };
}

function pipelineWorkerReadiness(env: Env): RuntimeReadinessItem {
  const secretReady = hasEnv(env, "FORGE_PIPELINE_WORKER_SECRET") || hasEnv(env, "CRON_SECRET");
  const missing = [
    ...(secretReady ? [] : ["FORGE_PIPELINE_WORKER_SECRET or CRON_SECRET"]),
    ...(hasPublicAppUrl(env) ? [] : ["FORGE_PUBLIC_APP_URL for worker route proof"])
  ];
  const status = !secretReady ? "missing" : missing.length ? "partial" : "ready";
  return {
    id: "pipeline_worker",
    label: "Pipeline worker",
    status,
    summary: !secretReady
      ? "Approved briefs can be queued, but no secured worker secret is configured to process them."
      : missing.length
        ? "Queued runs have worker auth, but the public worker route cannot be proved yet."
      : "Queued approved-brief research runs can be processed and externally proved by the secured worker endpoint.",
    detail: "Approving a research brief writes a queued pipeline run and agent tasks. POST /api/pipeline/worker with a bearer secret processes an explicit queued run or sweeps queued research-brief runs through managed research. Runtime health needs FORGE_PUBLIC_APP_URL to send a bearer-authenticated probe.",
    missing,
    setup: runtimeSetupReferences("pipeline_worker", env)
  };
}

function capability(input: {
  id: string;
  label: string;
  required: string[];
  readySummary: string;
  missingSummary: string;
  detail: string;
  env: Env;
}): RuntimeReadinessItem {
  const missing = input.required.filter((name) => !hasEnv(input.env, name));
  return {
    id: input.id,
    label: input.label,
    status: missing.length ? "missing" : "ready",
    summary: missing.length ? input.missingSummary : input.readySummary,
    detail: input.detail,
    missing,
    setup: runtimeSetupReferences(input.id, input.env)
  };
}

function gitHubAppReadiness(env: Env): RuntimeReadinessItem {
  const required = [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_SLUG",
    "GITHUB_WEBHOOK_SECRET",
    "FORGE_PUBLIC_APP_URL for GitHub callback and webhook proof"
  ];
  const coreRequired = ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_SLUG", "GITHUB_WEBHOOK_SECRET"];
  const missing = required.filter((name) => !hasEnv(env, name));
  const coreReady = coreRequired.slice(0, 3).every((name) => hasEnv(env, name));
  const configuredReady = coreRequired.every((name) => hasEnv(env, name));
  return {
    id: "github_app",
    label: "GitHub App",
    status: missing.length === 0 ? "ready" : coreReady || configuredReady ? "partial" : "missing",
    summary:
      missing.length === 0
        ? "Install, repo picker, installation tokens, and externally proved webhooks are configured."
        : configuredReady && !hasPublicAppUrl(env)
          ? "GitHub App credentials are configured, but callback and webhook proof need a public app URL."
        : coreReady
          ? "Repo picker and installation tokens can work, but lifecycle webhooks or external proof are incomplete."
          : "GitHub can read public repos without credentials, but user-scoped repo and PR paths need the App path.",
    detail: "Enables real user-scoped repo selection, private repo discovery, existing-repo PRs, and install lifecycle updates. FORGE_PUBLIC_APP_URL provides the callback/webhook URLs and lets runtime health prove the webhook route with a signed GitHub ping.",
    missing,
    setup: runtimeSetupReferences("github_app", env)
  };
}

function managedBuilderReadiness(env: Env): RuntimeReadinessItem {
  const wantsManaged = env.FORGE_BUILDER_ADAPTER === "managed";
  const required = ["GEMINI_API_KEY"];
  const oauthReady =
    (hasEnv(env, "GITHUB_APP_CLIENT_ID") || hasEnv(env, "GITHUB_CLIENT_ID")) &&
    (hasEnv(env, "GITHUB_APP_CLIENT_SECRET") || hasEnv(env, "GITHUB_CLIENT_SECRET"));
  const hostedStorageReady = hasEnv(env, "SUPABASE_URL") && hasEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const devTokenFallbackReady = envTokenFallbackReady(env);
  const optionalForGeneratedRepos = [
    "FORGE_GENERATED_REPO_OWNER",
    "FORGE_TEMPLATE_REPO_URL",
    "GitHub OAuth for user-account generated repo creation",
    "GITHUB_STATE_SECRET or GITHUB_WEBHOOK_SECRET for GitHub OAuth callback state",
    "FORGE_PUBLIC_APP_URL for GitHub OAuth callback setup proof",
    "FORGE_TOKEN_ENCRYPTION_KEY for hosted GitHub OAuth token storage"
  ];
  const missing = required.filter((name) => !hasEnv(env, name));
  const optionalMissing = optionalForGeneratedRepos.filter((name) =>
    name === "GitHub OAuth for user-account generated repo creation"
      ? !oauthReady
      : name === "GITHUB_STATE_SECRET or GITHUB_WEBHOOK_SECRET for GitHub OAuth callback state"
        ? oauthReady && !hasCallbackStateSecret(env)
      : name === "FORGE_PUBLIC_APP_URL for GitHub OAuth callback setup proof"
        ? oauthReady && !hasPublicAppUrl(env)
      : name === "FORGE_TOKEN_ENCRYPTION_KEY for hosted GitHub OAuth token storage"
        ? oauthReady && hostedStorageReady && !hasEnv(env, "FORGE_TOKEN_ENCRYPTION_KEY")
      : !hasEnv(env, name)
  );
  const allMissing = [...missing, ...optionalMissing];

  if (missing.length === 0 && optionalMissing.length === 0) {
    return {
      id: "managed_builder",
      label: "Managed builder",
      status: "ready",
      summary: "Managed builds can generate file bundles and create PRs with GitHub App repo access or OAuth generated-repo targets.",
      detail: "Uses Gemini plus project-linked GitHub App installation tokens for existing repos and GitHub user OAuth only for user-account generated repos.",
      missing: [],
      setup: runtimeSetupReferences("managed_builder", env)
    };
  }

  return {
    id: "managed_builder",
    label: "Managed builder",
    status: missing.length === 0 || !wantsManaged ? "partial" : "missing",
    summary: wantsManaged
      ? "Managed builder is selected but still missing live-build configuration."
      : devTokenFallbackReady && optionalMissing.includes("GitHub OAuth for user-account generated repo creation")
        ? "Local dev token fallback is available, but real user-account generated repo creation still needs GitHub OAuth."
      : "Simulated builds still work; managed PR creation is not fully configured.",
    detail: "Existing repos, pre-created generated repo targets, and organization generated repo creation use project-linked GitHub App tokens. User-account generated repo creation uses GitHub user OAuth. FORGE_GITHUB_TOKEN/GITHUB_TOKEN is ignored unless FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 is set for local dev, and local-dev fallback does not make the hosted product path ready. OAuth callback state should be signed with GITHUB_STATE_SECRET or GITHUB_WEBHOOK_SECRET, and hosted OAuth token storage requires FORGE_TOKEN_ENCRYPTION_KEY.",
    missing: allMissing,
    setup: runtimeSetupReferences("managed_builder", env)
  };
}

function storageReadiness(env: Env): RuntimeReadinessItem {
  if (forcedLocalStorage(env)) {
    return {
      id: "storage",
      label: "Storage",
      status: "partial",
      summary: "FORGE_STORAGE_BACKEND=local is forcing the local JSON store.",
      detail: "Use this for isolated fixtures and rendered UI checks. Unset FORGE_STORAGE_BACKEND, then configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before treating hosted workspace/RLS behavior as live.",
      missing: [],
      setup: runtimeSetupReferences("storage", env)
    };
  }

  const supabaseRequired = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = supabaseRequired.filter((name) => !hasEnv(env, name));
  return {
    id: "storage",
    label: "Storage",
    status: missing.length ? "partial" : "ready",
    summary: missing.length
      ? "Using the local JSON store; hosted workspace/RLS behavior is not live here."
      : "Supabase service storage is configured for server-side records.",
    detail: "Stores projects, scoped runtime records, GitHub connections, opportunities, builds, and reflection proposals.",
    missing,
    setup: runtimeSetupReferences("storage", env)
  };
}

function userSessionReadiness(env: Env): RuntimeReadinessItem {
  const hostedStorageReady = hasEnv(env, "SUPABASE_URL") && hasEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const requestAuthReady = hasEnv(env, "SUPABASE_URL") && hasEnv(env, "SUPABASE_ANON_KEY");
  const publicAppUrlReady = hasPublicAppUrl(env);
  const authRequired = ["1", "true", "yes"].includes((env.FORGE_REQUIRE_AUTH || "").toLowerCase());
  const envIdentityReady = hasEnv(env, "FORGE_AUTH_SUBJECT") || (hasEnv(env, "FORGE_USER_ID") && hasEnv(env, "FORGE_WORKSPACE_ID"));
  const missing = [
    ...(requestAuthReady ? [] : ["SUPABASE_URL and SUPABASE_ANON_KEY for request-session auth"]),
    ...(hostedStorageReady ? [] : ["SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for scoped server writes"]),
    ...(publicAppUrlReady ? [] : ["FORGE_PUBLIC_APP_URL for sign-in callback setup proof"])
  ];

  if (requestAuthReady && hostedStorageReady && publicAppUrlReady) {
    return {
      id: "user_session",
      label: "Email account",
      status: "ready",
      summary: authRequired
        ? "Email signup/sign-in is configured and required before scoped dashboard access."
        : "Hosted requests can derive Forge identity from Supabase email auth sessions.",
      detail: "Server-side dashboard code validates Authorization headers, Forge's session cookie, or Supabase auth cookies with /auth/v1/user, then maps the email auth subject through user_auth_identities or provisions the user's default workspace on first write. GitHub remains a connector after the Forge account exists.",
      missing: [],
      setup: runtimeSetupReferences("user_session", env)
    };
  }

  return {
    id: "user_session",
    label: "Email account",
    status: envIdentityReady && !authRequired ? "partial" : "missing",
    summary: envIdentityReady
      ? authRequired
        ? "Hosted email auth is required, but browser email sessions are not configured."
        : "Env-scoped identity can run local/server jobs, but email account sessions are not live."
      : "Forge can run local default identity, but hosted email accounts are not configured.",
    detail: "Set SUPABASE_ANON_KEY alongside hosted Supabase storage so dashboard requests can validate the signed-in user's Supabase Auth session instead of relying on FORGE_USER_ID/FORGE_AUTH_SUBJECT. Set FORGE_REQUIRE_AUTH=1 in hosted deployments to block fallback local identity. GitHub should be connected after email signup, not used as the primary account.",
    missing,
    setup: runtimeSetupReferences("user_session", env)
  };
}

function hasEnv(env: Env, name: string): boolean {
  if (name === "FORGE_PUBLIC_APP_URL for GitHub callback and webhook proof") {
    return hasPublicAppUrl(env);
  }
  return typeof env[name] === "string" && env[name]?.trim() !== "";
}

function hasPublicAppUrl(env: Env): boolean {
  return runtimePublicAppUrl(env) !== null;
}

export function forcedLocalStorage(env: Env = process.env): boolean {
  return env.FORGE_STORAGE_BACKEND?.trim().toLowerCase() === "local";
}

function hasCallbackStateSecret(env: Env): boolean {
  return hasEnv(env, "GITHUB_STATE_SECRET") || hasEnv(env, "GITHUB_WEBHOOK_SECRET");
}

function envTokenFallbackReady(env: Env): boolean {
  return githubTokenFallbackEnabled(env);
}
