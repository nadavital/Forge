# Forge Dashboard

Internal product-review UI for Forge.

## Quick start

From the Forge repo root:

```bash
pnpm install
pnpm setup
pnpm dev
```

Open **http://localhost:3000**. The local dashboard starts empty unless you have already created projects in
`.forge-data/store.json` or connected Supabase.

### What to click through

1. **Projects** — workspace overview across persisted projects
2. **+** in sidebar — add an existing GitHub repo or start a new product idea
3. **Project → Review** — opportunity cards after a real project run has produced records
4. **Project → Review → Explore idea** — talk through a new-product direction and approve a research brief
5. **Project → Settings** — edit sources, link repos through GitHub connections, schedule triggers, taste, and reflection proposals

### Reset local data

```bash
pnpm --filter @forge/dashboard seed:reset
pnpm setup
```

### Connect to Supabase

Apply the migrations in `supabase/migrations` and provide server-side credentials.

```bash
cp apps/dashboard/.env.local.example apps/dashboard/.env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_DB_URL
pnpm runtime:secrets
pnpm supabase:preflight -- --env-file apps/dashboard/.env.local
pnpm supabase:migrate -- --env-file apps/dashboard/.env.local --dry-run
pnpm supabase:migrate -- --env-file apps/dashboard/.env.local
pnpm dev
```

Without env vars, the dashboard uses **`.forge-data/store.json`** (gitignored). It starts empty and only shows
projects created through the app or records written by the local pipeline. When `.env.local` contains Supabase
credentials but you need an isolated local fixture or rendered UI check, run with `FORGE_STORAGE_BACKEND=local` and
optionally `FORGE_LOCAL_STORE_DIR=/path/to/store-dir`; that forces the repository layer to use JSON storage instead of
hosted Supabase for that process. Runtime readiness and `pnpm smoke:runtime` report this override as a local-storage
warning so it is not mistaken for hosted Supabase proof.

`SUPABASE_DB_URL` is only for local migration application. Do not ship it as runtime config; the dashboard runtime only
needs the URL, anon key, and service-role key. The migration helper checks that the DB URL contains the same Supabase
project ref as `SUPABASE_URL`; use `--skip-project-check` only after manually verifying a nonstandard target.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (webpack, Safari-safe CSS) |
| `pnpm setup` | Prepare local dashboard storage |
| `pnpm runtime:secrets` | Fill missing local runtime secrets in `.env.local` without printing values |
| `pnpm smoke:managed-research` | Start the real managed-research FastAPI service locally and verify the dashboard brief-research client contract |
| `pnpm supabase:preflight -- --env-file apps/dashboard/.env.local` | Check hosted Supabase env, `psql`, project-ref, and migration prerequisites without printing secrets |
| `pnpm supabase:migrate -- --env-file apps/dashboard/.env.local` | Apply hosted Supabase migrations with `SUPABASE_DB_URL` |
| `pnpm verify` | Run the full local proof bundle from the repo root |
| `pnpm seed:reset` | Delete local store (dashboard package); it will be recreated empty |

## Dashboard vs backend split

**Dashboard (this app)**

- Project onboarding with optional GitHub repo input, project settings UI, project review, opportunity detail
- User/workspace-scoped local records for projects and related runtime state
- AI-led idea conversation → compiled research brief → approved brief starts a project research run
- Review actions → `preference_events`
- Build button → build brief → Gemini managed builder when `GEMINI_API_KEY` is set, otherwise simulated builder → `mvp_builds` + `build_artifacts`
- Reflection proposal accept/reject
- Project scheduler control → runs due active schedule triggers for the selected project
- Connected product setup with a GitHub repo URL → README/issues/tree ingestion → Gemini/Antigravity repo analysis → repo-specific recommendations when semantic discovery returns them
- New product runs can start from an approved AI research brief. The dashboard queues agent tasks, calls `FORGE_MANAGED_RESEARCH_URL` when configured with `FORGE_MANAGED_RESEARCH_SECRET`, and stores returned source-backed signals/opportunity candidates. Local development can fall back to brief-origin hypothesis records; hosted auth-required mode fails the run instead of creating market-research cards until the managed research backend is configured.
- Set the same `FORGE_MANAGED_RESEARCH_SECRET` in the dashboard and managed-research service; the Python service rejects `/api/*` routes without bearer auth unless `FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH=1` is explicitly set for local throwaway development.
- Run again re-ingests the connected repo when a repo URL is configured, or refreshes new-product context signals when no repo is configured
- Archive project (hides it and disables triggers without deleting history)

**Still to wire**

- Apply the latest SQL migration to hosted Supabase
- Configure hosted Supabase Auth and `SUPABASE_ANON_KEY`, then prove request-session identity end to end
- Prove GitHub App install, OAuth callback, and webhooks against a live app
- Prove Supabase Realtime delivery against hosted RLS/channel policy
- Prove the Vercel Cron worker path against a deployed app with hosted storage and managed research configured

Project settings include a runtime-readiness panel for AI intake, managed research, GitHub App, managed builder, and
storage. It reports missing environment variable names and fallback states without sending secret values to the browser.
`FORGE_PUBLIC_APP_URL` is required for external callback/webhook/worker proof. When it is configured, the panel also shows the exact non-secret provider setup URLs to paste into
Supabase Auth and GitHub: `/auth/callback`, `/github/callback`, `/api/github/webhook`, and the worker endpoint. Each
URL is labeled as either a callback flow that still needs to be completed or a live path that can be proved by
**Check live paths**.
Use **Check live paths** to run server-side health checks: managed research pings `/health`, GitHub App validates app
credentials plus non-secret permission metadata, GitHub webhooks receive a signed `ping` probe when `FORGE_PUBLIC_APP_URL`
is configured, and Supabase storage verifies the required schema tables and columns when configured.
If `FORGE_STORAGE_BACKEND=local` is set, the storage check is skipped with an explicit local-override warning.
Health detail text redacts configured secrets and bearer/access/refresh token patterns before display.
The same checks can run from the command line:

```bash
pnpm smoke:runtime
FORGE_SMOKE_AUTH_BEARER=<supabase-access-token> pnpm smoke:runtime -- --strict
```

The smoke loads `.env.local` by default, prints only non-secret status summaries, and fails on hard errors. When any
live path is non-ready, it also prints a hosted setup handoff with concrete next actions, provider setup URLs derived
from `FORGE_PUBLIC_APP_URL`, and the proof still needed for each URL; pass `--no-handoff` for terse
output. `--strict` also treats warnings and skipped checks as failures, which is the mode to use for hosted end-to-end proof.
When hosted storage is missing tables or columns, the storage smoke classifies that as an incomplete schema and points to
`pnpm supabase:migrate`; runtime service-role credentials are not migration credentials.
Run `pnpm supabase:preflight -- --env-file apps/dashboard/.env.local` before migration or hosted smoke to catch a missing
DB URL, mismatched project ref, missing `psql`, or bad migration file set up front.
When hosted Supabase Auth is configured, dashboard requests validate `Authorization: Bearer ...` or standard
`sb-*-auth-token` cookies with `/auth/v1/user`; the resulting subject maps through `user_auth_identities` or provisions
that user's default workspace on first write. `FORGE_USER_ID`, `FORGE_WORKSPACE_ID`, and `FORGE_AUTH_SUBJECT` are
server-job/local-dev overrides, not the preferred hosted user path.
The `/signup` and `/login` pages request Supabase email magic links for the Forge account when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set. GitHub is connected later as a repo connector, not used as primary login. The
`/auth/callback` page accepts the returned session hash, clears the token-bearing URL before async validation can fail,
asks the server action to validate it with Supabase, then writes Forge's httpOnly access and refresh cookies. If the access cookie later fails validation or expires, the request-session
bridge can use the refresh cookie to obtain a fresh access token for that request. Set `FORGE_PUBLIC_APP_URL` to the deployed app origin so generated email
redirects, Supabase callback setup, GitHub callback setup, webhook proof, and worker proof all use the same public host. Set `FORGE_REQUIRE_AUTH=1` in hosted deployments so unauthenticated
dashboard routes redirect to `/login` before any project data is loaded under the local fallback identity. The repository
layer also refuses fallback identity under required auth for direct server-action/data calls; set
`FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=1` only for trusted background jobs that intentionally use env identity.

Project pages use Supabase Realtime for active run, research, opportunity, prototype, build, and reflection status updates
when `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and a valid Supabase Auth session are available. The browser receives the
Supabase URL, anon key, and a short-lived access token for the current user, then subscribes to project-scoped status
tables; RLS remains responsible for deciding which rows that token can receive. If the socket cannot subscribe or no
authenticated realtime token is available, the existing polling refresh remains as a fallback. Set
`FORGE_DISABLE_SUPABASE_REALTIME=1` to force polling while debugging hosted channel policy.

Approving an AI intake research brief enqueues work instead of running managed research inline in the server action. It
sets the brief to `running`, creates a queued `pipeline_runs` row and queued agent tasks, then returns to the UI.
When `FORGE_REQUIRE_AUTH=1`, the approval action first requires `FORGE_MANAGED_RESEARCH_URL` and
`FORGE_MANAGED_RESEARCH_SECRET`; if either is missing, the brief stays approved, the panel keeps a retry action visible,
and no doomed queued run is created.
The idea panel can run the visible queued research immediately after checking it belongs to the current project bundle.
`vercel.json` registers a daily Vercel Cron call to `GET /api/pipeline/worker`; set `CRON_SECRET` or
`FORGE_PIPELINE_WORKER_SECRET` in the deployment environment so the scheduled call can authenticate before sweeping queued
research-brief runs. The sweep resolves each run's project owner/workspace and processes under that scope, rather than
depending on the cron request to carry a user session. A hosted worker can also process a known run:

```bash
curl -X POST "$FORGE_PUBLIC_APP_URL/api/pipeline/worker" \
  -H "Authorization: Bearer $FORGE_PIPELINE_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"...","runId":"..."}'
```

It can also sweep queued research-brief runs through POST-based cron-style infrastructure:

```bash
curl -X POST "$FORGE_PUBLIC_APP_URL/api/pipeline/worker" \
  -H "Authorization: Bearer $FORGE_PIPELINE_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":5}'
```

Runtime health can send a bearer-authenticated `{"probe":true}` request to the same endpoint when `FORGE_PUBLIC_APP_URL`
and a worker secret are configured; the probe validates routing/auth without processing queued runs.
For a focused local or preview check, run:

```bash
pnpm worker:probe -- --url http://127.0.0.1:3000
```

For a local end-to-end queue proof that does not touch `.forge-data`, run:

```bash
pnpm smoke:worker-flow
```

The smoke uses `FORGE_LOCAL_STORE_DIR` internally to isolate a temporary store, queues an approved brief, runs a local
managed-research fixture, processes the queue, and verifies completed agent tasks plus persisted signals/opportunity
records.

`CRON_SECRET` is accepted as a fallback secret name. The endpoint currently processes research-brief runs only; the sweep
mode selects queued research-brief runs only and caps each request to a small batch.

## Managed builds

The build button always records the human approval and creates an auditable build brief. Local runs without credentials use the deterministic simulated adapter. To launch the Gemini managed builder, set:

```bash
FORGE_BUILDER_ADAPTER=managed
GEMINI_API_KEY=...
FORGE_GEMINI_BUILDER_AGENT=antigravity-preview-05-2026
FORGE_TEMPLATE_REPO_URL=https://github.com/forge-labs/mvp-template
FORGE_GENERATED_REPO_OWNER=rkibel
GITHUB_TOKEN=... # Optional local-dev fallback only when explicitly enabled and FORGE_REQUIRE_AUTH is off
FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=0
FORGE_ENABLE_GITHUB_DEV_FALLBACK=0
GITHUB_STATE_SECRET=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
FORGE_TOKEN_ENCRYPTION_KEY=...
```

Existing-product builds use the connected project `repo_url` and open a PR titled `Build MVP: <opportunity title>`. The project GitHub source must be linked to a GitHub App `github_connections` row so Forge can mint a short-lived installation token server-side to create the branch and PR. Stored GitHub App connections are PR-capable only when the installation permission summary includes `contents:write`. New-product builds target a generated repo named from the project and opportunity. If the project has a `github_generated_repo_target` source config for an organization installation, Forge can create the generated repo with the GitHub App installation token when the stored App permissions include both `contents:write` and `administration:write`, then open the PR with the same short-lived token. User-account generated repo creation uses GitHub App user OAuth when `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are configured; OAuth is not used to link connected-product repositories. User-account App installs are treated as pre-created repo targets only. `FORGE_GITHUB_TOKEN`/`GITHUB_TOKEN` is ignored unless `FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1` is set for local dev, and is always ignored when `FORGE_REQUIRE_AUTH=1`. The manual installation-id settings form is also local-dev only and appears only when `FORGE_ENABLE_GITHUB_DEV_FALLBACK=1`; it verifies the installation account before saving metadata. User-account App installs can target pre-created repos visible to the App. GitHub install/OAuth callbacks carry signed project state using `GITHUB_STATE_SECRET` or `GITHUB_WEBHOOK_SECRET`. The GitHub App or OAuth callback automatically records that generated-repo target for new-product projects, and settings can switch any active installation or authorized user connection to the generated-repo target without retyping ids. The managed agent can either return PR metadata directly or return a `files[]` bundle; when it returns files, Forge creates the generated repo or branch and opens the PR without exposing GitHub credentials to the sandbox.

Hosted connected-product research also requires the linked GitHub App connection. Local development can still inspect public repos from a raw URL, but with `FORGE_REQUIRE_AUTH=1` Forge stops the run with a setup message until the GitHub source has an active App connection. Project settings keep a GitHub source marked `needs_connection` paused and disable the generic `active` status until a scoped connection is linked.

Signed GitHub callback state expires after 15 minutes by default. Set `GITHUB_STATE_MAX_AGE_SECONDS` only if the install
or OAuth flow needs a different window. Callback redirects use bounded callback-safe messages; provider bodies, token
exchange errors, encryption/storage details, and configured secret values must not be echoed into `github_message`.

## GitHub repo demo

Create a connected product with a repo URL such as:

```text
https://github.com/rkibel/auto-drone
```

Forge fetches the repository metadata, README, and latest issues, then creates ranked opportunities from that repo context. Public repos work without credentials in local development, but hosted auth-required project creation stores the repo source as paused/needs-connection and waits for a scoped GitHub App connection before the initial discovery run. The connected-product setup checklist remains incomplete until the GitHub source is linked to that scoped connection, and the project review header routes to **Connect GitHub** instead of exposing a Dream run that is expected to fail. Project settings can store GitHub App installation metadata, GitHub App permission summaries, or GitHub user OAuth metadata in `github_connections`; Forge uses selected-repo App installations to list and link project repositories, while OAuth is reserved for user-account generated repos. Repository linking rejects revoked, reauth-required, incomplete App, and OAuth connections server-side even if a form posts their ids directly. General project settings do not accept raw repo URL edits and cannot activate a needs-connection GitHub source; repo changes go through the GitHub connection panel so the source config stays tied to scoped connection metadata. Configure the GitHub App webhook URL to `/api/github/webhook` and set `GITHUB_WEBHOOK_SECRET` so Forge can verify installation lifecycle events before marking connections `active`, `needs_reauth`, or `revoked`; runtime health can also send a signed `ping` event to that route when `FORGE_PUBLIC_APP_URL` is set, proving signature verification and route reachability without mutating connection rows. `GITHUB_STATE_SECRET` may be set separately for callback-state signing; when omitted, Forge uses `GITHUB_WEBHOOK_SECRET` for state signing. If GitHub reports that an installation no longer exists, Forge marks the connection `needs_reauth` and stops offering repo actions for it until it is reconnected.

## New product demo

For new products, leave the GitHub repository field blank and write one freeform **Starting idea** during project creation, or use **Explore idea** on the project review page later. With `GEMINI_API_KEY` configured, Forge treats that message as AI-led intake, compiles a structured research brief, and lets the user approve the brief before research agents are queued. If the model needs more context, the panel surfaces the compiler's own open questions and uses the first one as the next composer prompt; it does not run a fixed questionnaire. A `ready_for_research` brief is not approval; the pipeline only launches research after the user clicks **Research this** and the brief becomes `approved`. Queued research-task prompts preserve conversation-derived constraints, user taste notes, source plans, disqualifying evidence, MVP boundaries, and remaining uncertainty so downstream agents stay grounded in the user interaction. Source-backed opportunities show those same research guardrails on the opportunity detail page so the user can audit what came from the conversation. Without `GEMINI_API_KEY`, or when the compiler fails, Forge stores a non-approvable `needs_context` draft, keeps product follow-up questions derived from the user's conversation, and preserves the config/error reason as an internal constraint instead of turning the next user prompt into a setup error. Agent task chips show whether each research role is done, waiting for the managed backend, or waiting for a role-specific Taste/Bull/Bear/Decision/Synthesizer evaluation. When Synthesizer returns a builder payload, opportunity detail shows the build direction and the managed build brief puts user preference notes ahead of that Synthesizer direction.

Leaving the GitHub repository field blank during project creation creates a `new_product` project without creating a GitHub repo or requiring a server token. Forge waits for the AI-led idea conversation and an approved research brief before launching research.

To run source-backed brief research from the dashboard, start the Python service and set:

```bash
FORGE_MANAGED_RESEARCH_URL=http://localhost:8000
FORGE_MANAGED_RESEARCH_SECRET=shared-dev-secret
FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH=0
```
