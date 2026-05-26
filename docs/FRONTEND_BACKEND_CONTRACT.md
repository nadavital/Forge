# Frontend Backend Contract

This is the source of truth for connecting the Forge dashboard to the managed-agent backend.

Forge is still local-first, but records are now user/workspace-scoped so the product can support real users, teams, and multiple active apps without rewriting the core flow.

Hosted Supabase scope is enforced by the workspace RLS migrations. Browser-facing realtime or anon-key reads must use authenticated subjects that map through `user_auth_identities` to stable `users.id` values; service-role backend writes remain server-only. Server-side dashboard code first validates a request Supabase Auth bearer token from the `Authorization` header, `FORGE_AUTH_BEARER_COOKIE`, Forge's built-in `forge_supabase_access_token` cookie, or standard `sb-*-auth-token` cookies against `/auth/v1/user`. If cookie access validation fails or the access cookie has expired out of the browser jar and a refresh token is available, the request-session bridge calls Supabase Auth's refresh-token endpoint and validates the fresh access token for the current request. The `/signup` and `/login` pages request Supabase Auth email magic links with the anon key for the Forge account, and `/auth/callback` clears the returned token-bearing URL before validating the access token server-side and writing httpOnly Forge access/refresh cookies. GitHub must remain a post-account connector rather than a primary Forge login provider. Private beta deployments may set `FORGE_ALLOWED_EMAILS` and/or `FORGE_ALLOWED_EMAIL_DOMAINS`; Forge must reject non-invited emails before sending a magic link and must also treat a validated Supabase token for a non-invited email as unauthenticated. Hosted deployments should set `FORGE_REQUIRE_AUTH=1` so unauthenticated dashboard routes redirect to `/login` before project data is loaded through fallback identity. Repository identity resolution must also reject fallback identity under required auth for direct server-action/data calls unless `FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=1` is explicitly set for a trusted background job. The repository then resolves the subject through `user_auth_identities`, provisioning the user's default workspace on first write when no mapping exists. `FORGE_AUTH_SUBJECT`, `FORGE_USER_ID`, and `FORGE_WORKSPACE_ID` remain local/server-job overrides.

The account surface must keep this separation visible: `/account` should show the Forge email identity and workspace separately from GitHub connections, and GitHub OAuth rows must be labeled as generated-repo connectors rather than sign-in methods.

Hosted schema application is a separate operator step: run `pnpm supabase:preflight -- --env-file apps/dashboard/.env.local`, then `pnpm supabase:migrate -- --env-file apps/dashboard/.env.local` with `SUPABASE_DB_URL` before expecting service-role storage checks to pass. The dashboard service-role key is intentionally not treated as a migration credential. The preflight and migration helper refuse to run cleanly when `SUPABASE_URL` and `SUPABASE_DB_URL` appear to target different Supabase project refs unless `--skip-project-check` is explicitly passed.

Dashboard server reads must also keep that boundary before data leaves Supabase. When Supabase is configured, the generic repository loader first queries projects by active `owner_user_id` and `workspace_id`, then fetches project-owned child records only for those project ids. It does not fall back to local JSON for an empty hosted workspace. It returns `github_user_tokens` as an empty array; OAuth access and refresh tokens are read only through the explicit token lookup path for a selected connection.

The managed research service also treats legacy `/api/*` project/opportunity routes as scoped. Requests may send `X-Forge-User-Id` and `X-Forge-Workspace-Id`; otherwise the service falls back to `FORGE_USER_ID` and `FORGE_WORKSPACE_ID`. Project creation writes those fields, and raw-id project assertions include them in Supabase filters. Raw opportunity detail/action/build routes must first resolve the opportunity's parent project under the same scope; project-less legacy opportunity rows are not readable or actionable through those routes.

## Current Status

The current dashboard uses server actions and local library calls rather than separate HTTP API routes for the main app flow. It can run against `.forge-data/store.json` or Supabase through `apps/dashboard/lib/db/repository.ts`. `FORGE_STORAGE_BACKEND=local` explicitly selects the JSON store for fixture/rendered-local runs even when Supabase credentials are present in `.env.local`.

Implemented current path:

```text
project setup
  -> optional AI idea conversation and approved research brief
  -> repo/context analysis when repo_url exists
  -> brief-derived agent task queue when no repo exists
  -> signal + opportunity persistence
  -> dashboard recommendation review
  -> human build approval
  -> build brief
  -> simulated or managed builder
  -> build artifacts and reflection proposals
```

New-product setup can now compile an AI-led conversation into a `research_brief`. The project review header must route new-product primary actions into the conversation, model-generated follow-up, brief review, or active research state instead of exposing a generic Dream run before the AI/user interaction has produced an approved brief. Approved briefs can launch a run that queues agent tasks and, when `FORGE_MANAGED_RESEARCH_URL` and `FORGE_MANAGED_RESEARCH_SECRET` are configured, stores source-backed candidates plus Taste/Bull/Bear/Decision/Synthesizer-shaped evaluations from the managed research service. Hosted auth-required mode must fail the run before writing brief-origin opportunity cards when that backend is missing; local development may still use brief-origin hypothesis records as a demo fallback. Dashboard requests to managed brief research include the project `owner_user_id` and `workspace_id` in both the project payload and `X-Forge-User-Id` / `X-Forge-Workspace-Id` headers; the managed service echoes the resolved `request_scope` in the response so stored run metadata can audit which scope produced the research. Managed research also returns an `evidence_summary` rollup and per-opportunity evidence sufficiency fields so stored run metadata and opportunity profiles distinguish thin research from build-ready evidence. The dashboard promotes only candidates whose profile explicitly marks `evidence_sufficient_for_build = true`; other candidates are preserved as unpromoted run metadata. The dashboard maps returned evaluator roles onto phase-labeled agent progress for source collection, market research, taste critique, Bull/Bear review, decision, and build direction so missing Taste/Bull/Bear/Decision/Synthesizer output stays visible instead of being collapsed into a generic completed state, and task summaries use the same evidence rollup to say when the completed recommendation is still `research_more`. Fallback Synthesizer payloads must mark `builder_readiness = "not_ready"` and omit a builder prompt unless the candidate explicitly clears the same evidence gate.

Opportunity cards must preserve evidence state. A `profile.evidence_state = "brief_only"` card is a hypothesis from the approved conversation, not a source-backed recommendation. Source-collected and repo-derived cards should be labeled separately so the user can tell market research inputs from user-authored direction.

The API routes below are the target backend contract. Keep them aligned with the server-action behavior while the app remains local-first.

## Product Flow

```text
project setup
  -> AI idea intake when no repo exists
  -> approved research brief
  -> repo/context analysis
  -> scheduled or manual discovery run
  -> signal collection
  -> opportunity clustering
  -> Taste/Bull/Bear/Decision/Synthesizer
  -> recommended opportunities
  -> user notes and build approval
  -> Antigravity managed build
  -> PR and optional preview for the project repo
```

The frontend should show only opportunities that have passed the agent evaluation gate. Raw signals are backend evidence, not the primary product surface.

## Ownership Boundaries

- Frontend owns UI state, forms, project navigation, readable run/build status, opportunity review, and user notes.
- Backend owns Supabase writes, managed-agent calls, GitHub/repo operations, schedules, and Antigravity build invocation.
- Frontend must not receive service-role keys, GitHub tokens, raw API keys, or raw managed-agent prompts.
- User notes are higher priority than agent-generated suggestions when they contradict.
- GitHub repo access should be represented as `github_connections` metadata and short-lived server-side access tokens, not broad user-pasted tokens in browser state.
- GitHub App installation tokens are minted server-side from `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`; the frontend should only see connection status, safe health metadata such as permissions/expiry/repository count, and install/repo-picker links.
- GitHub App and GitHub user OAuth connections can be saved without linking a repo. For new-product projects, the GitHub callback should automatically record the active installation or authorized user connection as the generated-repo target, and settings may switch any active connection to that target. Existing project repo picker, connected-repo discovery, and existing-repo PR creation should use a project-linked GitHub App installation before considering any fallback; GitHub user OAuth is a generated-repo connector only, not the path for connected-product repository access. App callbacks must store the installation permission summary from GitHub, not a guessed static scope list. For generated MVP builds, organization installations may create the generated repo with a GitHub App installation token only when the stored permissions include `contents:write` and `administration:write`; user-account repo creation requires GitHub user OAuth. GitHub App user installations may target pre-created generated repos visible to the App, but must not be marked as repo-creation capable. `FORGE_GITHUB_TOKEN`/`GITHUB_TOKEN` is a local-dev fallback only when `FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1` and is ignored when `FORGE_REQUIRE_AUTH=1`; manual installation-id entry is a separate local-dev fallback and must be hidden and rejected unless `FORGE_ENABLE_GITHUB_DEV_FALLBACK=1`.
- Managed builds must fail fast before creating a build row or marking an opportunity `building` when the target cannot produce a PR with a project-linked GitHub connection. Existing-repo builds require the linked GitHub App source connection, and new-product generated-repo builds require a generated-repo target connection unless the explicit local-dev token fallback is enabled. Stored GitHub App connections are PR-capable only when their persisted permission summary includes `contents:write`. Opportunity build readiness shown in the UI must use the same project build-path readiness as the server action so missing `GEMINI_API_KEY`, missing GitHub target, or insufficient GitHub App permissions are visible before the user clicks Build.
- Managed brief research may include a request-scoped `github_access_token` only when the project has an active linked GitHub connection. The managed research service must treat that token as transient collector auth and must not persist it. Broad `GITHUB_TOKEN`/`FORGE_GITHUB_TOKEN` fallback remains local-dev only behind `FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1` and is ignored when `FORGE_REQUIRE_AUTH=1`.
- Server actions that attach a GitHub connection to a project must prove the connection is in the active user's workspace, owned by the active user, or already linked to that project. Raw connection ids from the browser are not trusted as authorization. Repository-link actions must also reject revoked, reauth-required, incomplete App connections, and GitHub user OAuth connections even if the browser submits their ids directly.
- General project-settings saves must not mutate `repo_url` or GitHub source config. Repo changes go through the GitHub connection/repo-picker actions so connected-product discovery and PR creation keep a scoped connection id. A GitHub source with `config.needs_connection = true` and no `connection_id` must remain `paused` even if a generic settings form submits `active`.
- GitHub install and OAuth links must use server-signed callback state with `GITHUB_STATE_SECRET` or `GITHUB_WEBHOOK_SECRET` before trusting the returned project id. Signed state expires after 15 minutes by default and may be tuned with `GITHUB_STATE_MAX_AGE_SECONDS`. Local/dev raw project ids are accepted only when no state secret is configured and `FORGE_REQUIRE_AUTH` is not enabled. Hosted auth-required project pages must not render project-scoped GitHub install/OAuth links until signed state is available, and hosted GitHub callbacks must require a signed-in Supabase session before loading project data or saving project-scoped connection rows.
- Auth and GitHub callback-facing errors must use callback-safe messages. Provider response bodies, token exchange errors, encryption/storage failures, configured secret values, and bearer/access/refresh token patterns must not be echoed into redirect query strings or callback UI.
- GitHub App webhooks must be verified server-side with `GITHUB_WEBHOOK_SECRET` and `X-Hub-Signature-256` before mutating connection status.
- Route-level webhook tests must cover invalid signatures as non-mutating failures and valid signed installation lifecycle payloads as status-changing events.
- Runtime health may prove webhook reachability with a signed GitHub `ping` event when `FORGE_PUBLIC_APP_URL` is configured; the `ping` event must verify the signature and return an ignored response without mutating connection rows.
- When a server-side GitHub App request proves an installation is gone, the backend marks the connection `needs_reauth`; the frontend should disable token-backed repo actions for non-active connections.
- Runtime-readiness checks must run server-side. The frontend may receive missing environment variable names, non-secret status summaries, provider setup URLs derived from `FORGE_PUBLIC_APP_URL`, non-secret proof labels, safe GitHub permission metadata, and safe health metadata, but never secret values or raw credentials. `FORGE_PUBLIC_APP_URL` is required before externally-called paths are considered ready: Supabase sign-in callback setup, GitHub App setup/OAuth callbacks, GitHub webhooks, queued worker route proof, and GitHub OAuth token-storage setup. The provider setup URLs are `/auth/callback` for Supabase Auth, `/github/callback` for GitHub App setup/OAuth, `/api/github/webhook` for GitHub webhooks, and `/api/pipeline/worker` for queued research worker probes. Setup URLs must distinguish configured-only callback flows from live-proved runtime-health paths; webhook, worker, and signed-in-session proof may be marked proved only after the relevant runtime health item returns `ok`. Any endpoint response body or thrown error included in health details must redact configured secrets plus bearer/access/refresh token patterns before it reaches the browser or CLI. GitHub App health should warn when app-level permissions cannot support the configured paths, or when a configured webhook secret cannot be proved against a public app URL: `contents:write` for server-side PR branches/file commits, issue read support for connected-product issue evidence, and `administration:write` only for organization generated-repo creation.

## Status Values

Use these exact string values unless this doc is updated.

```ts
export type ProjectMode = "connected_product" | "new_product";

export type RunStatus = "queued" | "in_progress" | "completed" | "failed";

export type PipelineStage =
  | "project_analysis"
  | "signal_collection"
  | "opportunity_clustering"
  | "bull_bear"
  | "synthesis"
  | "ready"
  | "failed";

export type OpportunityStatus =
  | "recommended"
  | "watched"
  | "rejected"
  | "approved"
  | "building"
  | "built";

export type OpportunityAction =
  | "watch"
  | "reject"
  | "research_more"
  | "approve_for_build";

export type BuildStatus = "in_progress" | "completed" | "failed";
```

## Data Shapes

### Project

Every active Forge project must have or be able to create an associated GitHub repo before a build starts.

```ts
export type Project = {
  id: string;
  owner_user_id: string | null;
  workspace_id: string | null;
  name: string;
  mode: ProjectMode;
  repo_url: string | null;
  product_url: string | null;
  description: string;
  archived_at: string | null;
  product_context: string | null;
  schedule: ProjectSchedule | null;
  latest_run: ProjectRun | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSchedule = {
  enabled: boolean;
  cron: string;
  timezone: string;
  next_run_at: string | null;
};
```

### GitHub Connection

```ts
export type GitHubConnection = {
  id: string;
  owner_user_id: string;
  workspace_id: string | null;
  provider: "github_app" | "github_oauth";
  account_login: string;
  account_type: "User" | "Organization" | null;
  installation_id: string | null;
  scopes: string[];
  status: "active" | "revoked" | "needs_reauth";
};
```

`owner_user_id`, `provider`, and `account_login` form the logical uniqueness boundary. A user can have both a GitHub App
installation connection and a GitHub OAuth connection for the same login because generated-repo creation and installation
repo access have different permission models.

### Idea Conversation And Research Brief

```ts
export type IdeaConversation = {
  id: string;
  project_id: string;
  user_id: string | null;
  status: "active" | "brief_ready" | "researching" | "closed";
};

export type ResearchBrief = {
  id: string;
  project_id: string;
  conversation_id: string | null;
  status: "needs_context" | "ready_for_research" | "approved" | "running" | "completed";
  hypothesis: string;
  target_users: string[];
  pain_area: string;
  constraints: string[];
  source_plan: string[];
  disqualifying_evidence: string[];
  mvp_boundaries: string[];
  user_taste_notes: string[];
  open_questions: string[];
  confidence: number | null;
};
```

`ready_for_research` means the AI intake compiler produced a coherent brief for the user to review. It is not approval. Backend pipeline launches must require `approved`; manual Dream runs must ignore ready-but-unapproved briefs. The dashboard primary action for a new-product project must stay in the idea-intake panel until an approved brief is actively researched, and should label each state from the current brief or queued run instead of asking fixed setup questions. New-product runs with no repository and no approved brief must complete as waiting-for-brief metadata without replacing existing source-backed signals or opportunities. The compiler must downgrade model output back to `needs_context` unless the brief includes a hypothesis, specific target users, a pain area, a source plan, disqualifying evidence, and MVP boundaries. Downgraded briefs should preserve model-generated open questions when available; deterministic fallback follow-ups must be derived from the conversation and limited to one or two prompts, not a full field checklist. Missing or failed compiler paths must also produce conversation-derived product follow-ups and keep the brief non-approvable; setup/error details belong in constraints or metadata, not in the visible open-question list.

Approved brief research must treat `source_plan` as an execution hint, not just display copy. The managed research service should route explicit GitHub, Reddit, Hacker News, and Stack Exchange mentions into the matching deterministic collectors; preserve the original source plan on collected media metadata; and fall back to broad public-source collection when the plan names generic communities without a specific source. The dashboard should forward a scoped GitHub token to managed research only when the approved source plan can route to GitHub collection; plans that explicitly name only non-GitHub sources must not receive a GitHub token. Dashboard run metadata should retain a compact audit trail with the brief source plan, enabled collectors, collected source counts, and concrete targets such as subreddits or Stack Exchange sites.

When a conversation reaches `closed` through completed research, the next user idea message must create a fresh `idea_conversation` and research brief candidate. Closed conversations remain evidence/history for the completed direction; they are not silently mutated into a different product idea.

Scheduled project triggers must also respect the same brief gate. Connected-product schedules may run from repository context; new-product schedules should be marked checked and skipped until the project has an `approved` research brief, avoiding repeated waiting runs that are not tied to a user-approved direction.

Default trigger posture for new projects:

```json
{
  "manual_review": "active",
  "weekday_morning": "paused",
  "timezone": "America/Los_Angeles"
}
```

Project onboarding should create a manual idea source for every project and a GitHub source config for every project. The GitHub source is `active` when a repo can be used immediately and `paused` while it is waiting for repo selection or a scoped hosted connection. For connected products, onboarding/setup is not complete until that GitHub source also has a scoped GitHub App `connection_id`; a raw public repo URL may support local-dev public discovery, but hosted auth-required connected-product creation should mark the GitHub source as needing a connection and wait for the scoped GitHub App connection instead of immediately creating a failed discovery run. The project review header should route those projects to GitHub setup rather than offering a generic Dream run that is known to fail. Settings should show the source as waiting for connection and must not let generic source-status saves activate it before the scoped connection is linked. Any later hosted connected-product research must stop with an explicit GitHub-connection setup message until the GitHub source is linked to an active GitHub App connection. A raw repo URL or GitHub user OAuth token is not a full GitHub connection for private repo access, managed research GitHub collection, or PR creation.

### Project Run

```ts
export type ProjectRun = {
  id: string;
  project_id: string;
  status: RunStatus;
  stage: PipelineStage;
  trigger: "manual" | "scheduled" | "onboarding";
  started_at: string;
  completed_at: string | null;
  error: string | null;
  summary: string | null;
};
```

The project-page idea surface also exposes the latest research run status. When managed research returns an
`evidence_summary`, the dashboard maps it to a compact evidence status:

```ts
export type LatestResearchRun = {
  id: string;
  status: string;
  evidence_summary?: {
    opportunities: number;
    build_ready_opportunities: number;
    needs_more_evidence_opportunities: number;
    reasons: string[];
  };
};
```

### Opportunity Card

This is the list item shape for the project dashboard.

```ts
export type OpportunityCard = {
  id: string;
  project_id: string;
  title: string;
  problem: string;
  target_user: string;
  mvp_concept: string;
  confidence: number;
  status: OpportunityStatus;
  evidence_count: number;
  evidence_state: "brief_only" | "source_collected" | "repo_evidence" | "manual_context" | "unknown";
  synthesized_pitch: string | null;
  builder_readiness: "ready" | "not_ready" | null;
  latest_evaluation_run_id: string | null;
  created_at: string;
};
```

### Opportunity Detail

```ts
export type OpportunityDetail = OpportunityCard & {
  evidence_summary: {
    signal_count: number;
    top_sources: string[];
    research_summary: string;
  };
  bull_case: {
    summary: string;
    confidence: number;
    bullets: string[];
  } | null;
  bear_case: {
    summary: string;
    confidence: number;
    risks: string[];
    missing_evidence: string[];
  } | null;
  decision: {
    recommendation: "watch" | "research_more" | "prototype" | "build" | "reject";
    summary: string;
    confidence: number;
    required_constraints: string[];
  } | null;
  synthesis: {
    product_pitch: string;
    mvp_scope: string[];
    non_goals: string[];
    builder_system_prompt: string;
    builder_readiness: "ready" | "not_ready";
  } | null;
  user_notes: string | null;
};
```

Dashboard opportunity detail should surface `synthesis.product_pitch` and the concise build direction when present. Managed build briefs should include user notes before Synthesizer output so human steering wins when it conflicts with agent synthesis.

### Build

```ts
export type Build = {
  id: string;
  project_id: string;
  opportunity_id: string;
  status: BuildStatus;
  stage: "starting_managed_builder" | "building" | "opening_pr" | "completed" | "failed";
  repo_url: string;
  branch_name: string | null;
  pr_url: string | null;
  preview_url: string | null;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};
```

## API Routes

All routes return JSON. Backend should return `4xx` for invalid user input and `5xx` for backend/agent failures.

### Create Project

```http
POST /api/projects
```

Request:

```json
{
  "mode": "connected_product",
  "name": "My App",
  "description": "Short user-provided product description",
  "repo_url": "https://github.com/user/repo",
  "product_url": "https://example.com",
  "schedule": {
    "enabled": true,
    "cron": "0 8 * * 1-5",
    "timezone": "America/Los_Angeles"
  }
}
```

For a new product, `repo_url` may be `null`; builds that need a PR require a repository before launch.

Response:

```json
{
  "project": {
    "id": "uuid",
    "name": "My App",
    "mode": "connected_product",
    "repo_url": "https://github.com/user/repo",
    "product_url": "https://example.com",
    "description": "Short user-provided product description",
    "archived_at": null,
    "product_context": null,
    "schedule": {
      "enabled": true,
      "cron": "0 8 * * 1-5",
      "timezone": "America/Los_Angeles",
      "next_run_at": "2026-05-24T15:00:00Z"
    },
    "latest_run": null,
    "created_at": "ISO",
    "updated_at": "ISO"
  },
  "next_recommended_action": "run_discovery"
}
```

### List Projects

```http
GET /api/projects
```

Response:

```json
{
  "projects": []
}
```

### Get Project

```http
GET /api/projects/:projectId
```

Response:

```json
{
  "project": {}
}
```

### Update Project

```http
PATCH /api/projects/:projectId
```

Request may include `name`, `description`, `repo_url`, `product_url`, `product_context`, source config statuses, trigger statuses, or `schedule`.

Response:

```json
{
  "project": {}
}
```

### Archive Project

```http
POST /api/projects/:projectId/archive
```

Archive is the default remove behavior in v1. It hides the project from active navigation and disables future triggers while preserving historical signals, opportunities, builds, and decisions for audit.

### Brainstorm New Project

Use this when the user does not know what they want to build. Backend should use Gemini managed agents to interview/brainstorm, seed topics, and create a project context.

```http
POST /api/projects/:projectId/brainstorm
```

Request:

```json
{
  "user_prompt": "I like developer tools, AI agents, and fast MVPs.",
  "constraints": ["free services only", "can be built in a weekend"]
}
```

Response:

```json
{
  "run": {
    "id": "uuid",
    "project_id": "uuid",
    "status": "in_progress",
    "stage": "project_analysis",
    "trigger": "onboarding",
    "started_at": "ISO",
    "completed_at": null,
    "error": null,
    "summary": null
  }
}
```

### Import GitHub Project

Use this when the user connects an existing repo. Backend should inspect the repo enough to produce `product_context`, suggested source config, and initial research scope.

```http
POST /api/projects/:projectId/import-github
```

Request:

```json
{
  "repo_url": "https://github.com/user/repo"
}
```

Response:

```json
{
  "run": {
    "id": "uuid",
    "status": "in_progress",
    "stage": "project_analysis"
  }
}
```

### Start Discovery Run

```http
POST /api/projects/:projectId/runs
```

Request:

```json
{
  "run_type": "discovery",
  "trigger": "manual",
  "scope": {
    "repo": true,
    "market_signals": true,
    "github_issues": true,
    "web_research": true
  }
}
```

Response:

```json
{
  "run": {
    "id": "uuid",
    "project_id": "uuid",
    "status": "in_progress",
    "stage": "signal_collection",
    "trigger": "manual",
    "started_at": "ISO",
    "completed_at": null,
    "error": null,
    "summary": null
  }
}
```

### List Project Runs

```http
GET /api/projects/:projectId/runs
```

Response:

```json
{
  "runs": []
}
```

### Get Run

```http
GET /api/runs/:runId
```

Response:

```json
{
  "run": {}
}
```

### List Recommended Opportunities

Only return opportunities with completed Taste/Bull/Bear/Decision/Synthesizer evaluation and sufficient confidence.

```http
GET /api/projects/:projectId/opportunities
```

Response:

```json
{
  "opportunities": []
}
```

### Get Opportunity Detail

```http
GET /api/opportunities/:opportunityId
```

Response:

```json
{
  "opportunity": {}
}
```

### Opportunity Action

```http
POST /api/opportunities/:opportunityId/actions
```

Request:

```json
{
  "action": "approve_for_build",
  "user_notes": "Focus on MCP servers only. Do not build a generic schema validator."
}
```

Response:

```json
{
  "opportunity": {
    "id": "uuid",
    "status": "approved",
    "user_notes": "Focus on MCP servers only. Do not build a generic schema validator."
  }
}
```

### Start Build

Builds go to the repo associated with the project. After a build starts, there is no user input in that build. Corrections should create a follow-up build/action.

The backend must reject build starts when the opportunity is still `brief_only`, has unknown/manual-only evidence, or the decision recommendation is `research_more`, `watch`, or `reject`. Build approval is only valid for source-collected or repo-evidence opportunities whose decision is `prototype` or `build`. Source-collected market opportunities must have at least two linked source signals and at least one cited source URL before build approval; repo-evidence opportunities must have at least one linked repo signal. For managed builds, the same readiness gate must also reject missing `GEMINI_API_KEY`, missing project GitHub targets, and stored GitHub App connections that lack required write permissions before creating an `mvp_builds` row.

```http
POST /api/opportunities/:opportunityId/builds
```

Request:

```json
{
  "build_type": "prototype_pr",
  "user_notes": "Make this a CLI plus small web dashboard. Keep it local-only."
}
```

Backend build prompt must include, in priority order:

1. User notes from this request.
2. Saved opportunity user notes.
3. Synthesizer `builder_system_prompt`.
4. Project context and repo URL.
5. Generated PR contract from `AGENTS.md`.

Response:

```json
{
  "build": {
    "id": "uuid",
    "project_id": "uuid",
    "opportunity_id": "uuid",
    "status": "in_progress",
    "stage": "starting_managed_builder",
    "repo_url": "https://github.com/user/repo",
    "branch_name": null,
    "pr_url": null,
    "preview_url": null,
    "summary": null,
    "error": null,
    "started_at": "ISO",
    "completed_at": null
  }
}
```

### Get Build

```http
GET /api/builds/:buildId
```

Response:

```json
{
  "build": {}
}
```

## Realtime Contract

Project pages subscribe to Supabase Realtime for status tables and refetch server-rendered details when an event arrives.
The browser receives `SUPABASE_URL`, the anon key, and a short-lived Supabase access token for the current signed-in user;
service-role credentials and refresh tokens remain server-side. The Realtime join payload includes that access token so
Postgres Changes can enforce the same RLS policies used by authenticated browser reads. When realtime is disabled, the
request has no authenticated realtime token, or the socket cannot subscribe, the local-first dashboard keeps the small
active-status polling bridge for running project runs, research tasks, and non-terminal builds.

Frontend cares about these events:

```ts
export type RealtimeEvent =
  | {
      type: "run_updated";
      project_id: string;
      run_id: string;
      status: RunStatus;
      stage: PipelineStage;
    }
  | {
      type: "opportunity_ready";
      project_id: string;
      opportunity_id: string;
    }
  | {
      type: "build_updated";
      project_id: string;
      build_id: string;
      status: BuildStatus;
      pr_url?: string;
      preview_url?: string;
    };
```

The current subscription contract is table-oriented rather than custom-event-oriented: one project channel subscribes to
`pipeline_runs`, `idea_conversations`, `research_briefs`, `agent_tasks`, `opportunities`, `prototype_options`,
`mvp_builds`, and `reflection_runs` with `project_id=eq.<projectId>` filters. Migration
`0013_realtime_status_publication.sql` adds exactly those tables to the `supabase_realtime` publication when that
publication exists. Any `postgres_changes` message refreshes the project page; details are loaded through the normal
scoped server read path.

Do not stream raw logs in v1. Show readable status:

```text
Analyzing repo
Collecting market signals
Clustering opportunities
Running Bull/Bear review
Writing product pitch
Building prototype
Opening PR
Completed
Failed
```

## Pipeline Worker Contract

Approving an AI intake research brief is a two-step durable flow. The server action updates the brief to `running`,
creates a queued `pipeline_runs` row, creates queued agent tasks for `SourceCollector`, `Researcher`, `TasteCritic`,
`BullAgent`, `BearAgent`, `DecisionAgent`, and `Synthesizer`, then returns to the user. Hosted infrastructure processes the run by
calling:

In hosted auth-required mode, approval must first verify that the managed research backend is configured. If
`FORGE_MANAGED_RESEARCH_URL` or `FORGE_MANAGED_RESEARCH_SECRET` is missing, the brief may remain `approved`, but Forge
must not create a queued run or agent tasks that can only fail later. The project page should keep a retry action visible
for approved briefs that have no queued/running research run.

```http
GET /api/pipeline/worker
Authorization: Bearer <CRON_SECRET or FORGE_PIPELINE_WORKER_SECRET>
```

Sweeps the oldest queued research-brief runs and resolves each run's project owner/workspace before loading scoped
project data. The cron request is authenticated by worker secret, but it does not need to carry a browser session and does
not collapse all queued work into one env-scoped workspace. Optional query params:

```text
projectId=<project-id>
limit=<small-number>
```

`apps/dashboard/vercel.json` registers this path as the daily hosted cron entry. The schedule is intentionally daily so
it can deploy on Vercel Hobby projects while the queue contract is still v1.

```http
POST /api/pipeline/worker
Authorization: Bearer <FORGE_PIPELINE_WORKER_SECRET>
Content-Type: application/json
```

```json
{
  "projectId": "project_...",
  "runId": "run_..."
}
```

For cron-style infrastructure that does not already know run ids, the same endpoint accepts an empty body or:

```json
{
  "limit": 5
}
```

and sweeps the oldest queued research-brief runs under each owning project scope. A bearer-authenticated
`{"probe":true}` request validates endpoint routing and authorization without processing queued runs; runtime health uses
that mode when `FORGE_PUBLIC_APP_URL` is configured. `CRON_SECRET` is accepted as a deployment fallback secret name. The
first implementation supports queued research-brief runs only; it does not process repo-analysis, build, or arbitrary
trigger work.

`pnpm smoke:worker-flow` is the local lifecycle proof for this contract. It sets `FORGE_LOCAL_STORE_DIR` to a temporary
directory, queues an approved brief, serves a local managed-research fixture, runs the worker sweep, and asserts that the
run, brief, agent tasks, source-backed signals, and opportunity records all persist as expected without touching the
developer's `.forge-data` store.

Worker outcomes:

- `completed`: managed research or a local-dev brief-origin fallback produced records, tasks were updated, and the run was completed.
- `failed`: tasks and the run were marked failed, and the brief was returned to `approved`.
- `skipped`: the run was already terminal.

## Supabase Mapping

Existing tables:

```text
pipeline_runs
signals
opportunities
opportunity_signals
opportunity_evaluations
```

Needed for the full dashboard contract:

```text
projects
project_source_configs
project_runs
project_schedules
opportunity_actions
mvp_builds
```

Optional later table:

```text
opportunity_clusters
```

For now, cluster packets may remain in `pipeline_runs.metadata` with `metadata.pipeline = "opportunity_clustering"`.

## Backend Pipeline Requirements

For a discovery run, backend must perform these steps:

1. Create or update `project_runs` as `in_progress`.
2. Analyze project repo/context when present.
3. Collect public/repo/social signals.
4. Save `signals`.
5. Create rough `opportunities`.
6. Link evidence with `opportunity_signals`.
7. Cluster duplicate/related opportunities.
8. Run TasteCritic, BullAgent, BearAgent, DecisionAgent, and Synthesizer on canonical clusters.
9. Save evaluator outputs to `opportunity_evaluations`.
10. Mark only confident opportunities as `recommended`.
11. Mark run `completed` or `failed`.

## Frontend Requirements

The first useful dashboard should include:

- Sidebar project list and create/import project action.
- Project command center as the main page.
- Repo URL, schedule, latest run status, and Run Now button.
- Recommended opportunity cards.
- Opportunity detail drawer or page with pitch, evidence summary, Bull/Bear rationale, decision, user notes, and Build Prototype button.
- Build status section with PR and preview links when available.

Avoid exposing raw signals as the main view. Evidence can appear as a collapsible research section under opportunity detail.

## Verification Checklist

Frontend can verify against mocked API responses before backend routes exist:

- Create project form can submit the `POST /api/projects` request shape.
- Project page can render a `Project` with no latest run.
- Project page can render `latest_run.status = "in_progress"` and `stage = "bull_bear"`.
- Opportunity list only uses `OpportunityCard`.
- Opportunity detail renders missing Bull/Bear/Synthesis sections without crashing.
- User notes are sent with `approve_for_build` and with `POST /builds`.
- Build status renders `in_progress`, `completed`, and `failed`.

Backend can verify:

- Every route returns the documented envelope key: `project`, `projects`, `run`, `runs`, `opportunity`, `opportunities`, or `build`.
- Run statuses use only `queued`, `in_progress`, `completed`, `failed`.
- Pipeline stages use only the listed `PipelineStage` values.
- Recommended opportunities have Synthesizer output and Decision confidence.
- `POST /builds` refuses to start without a project repo URL.
- Managed build prompts include user notes before Synthesizer output.
- No frontend response includes service-role keys, GitHub tokens, API keys, or raw managed-agent prompts.

## Current Backend Reality

Implemented now:

- Managed research ingestion CLI.
- Public source collection.
- Opportunity clustering.
- Taste/Bull/Bear/Decision/Synthesizer managed-agent evaluation.
- Fast fallback research/evaluation path that still returns Bull/Bear/Synthesizer-shaped artifacts when managed agents are slow or quota-limited.
- Supabase writes to existing ingestion/evaluation tables.
- Dashboard API routes under `forge_managed_research.api`.
- Project, schedule, run, action, and build migration in `supabase/migrations/0002_dashboard_contract.sql`.
- Local dashboard demo loop for preference-aware reranking, generated prototype option records, BuildReviewer artifact checks, and reflection proposal generation from stored events/builds.

Not implemented yet:

- Applied remote dashboard migration, unless a developer has run `0002_dashboard_contract.sql` in Supabase.
- Hosted schedule runner. A local due-trigger helper exists for demo/local worker wiring.
- Production Antigravity adapter hardening. The dashboard can select a Gemini managed builder when configured, but the hackathon-safe path remains the deterministic simulated builder.
- Realtime dashboard subscriptions.

Build the frontend against this contract while backend fills those missing pieces.
