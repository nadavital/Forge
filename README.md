# Forge

Forge is a product-first agent system for turning project context, source evidence, and user taste into reviewed product opportunities and approved prototype or MVP build work.

The current repository is an early vertical slice, not just a scaffold. It includes a Next.js dashboard, local/Supabase storage contracts, user/workspace-scoped project records, GitHub connection records, AI-led idea intake, connected-repo discovery, semantic repo analysis through a Gemini/Antigravity-style agent path, opportunity review actions, build brief generation, simulated and managed builder adapters, and a simple reflection proposal loop.

Forge is still not a complete autonomous product-discovery platform. The strongest current path is connected-product review from a GitHub repo. New-product mode now supports an AI-led idea conversation that compiles a research brief; approved briefs can call the managed research backend for source-plan-routed public collection and Bull/Bear/Decision/Synthesizer-shaped evaluation when configured. New-product runs without an approved brief wait for the conversation instead of replacing existing researched opportunities with local context.

## Current Product Shape

Forge currently behaves like a product review and build-orchestration workbench:

1. Create a connected-product or new-product project.
2. Store explicit product context, source configs, GitHub connection metadata, triggers, and user preferences under a user/workspace scope.
3. Run Dream for a connected-product project, or seed a new-product project with one freeform idea message.
4. For new products, Forge creates a `new_product` project without creating a repo, starts or routes into the AI-led conversation, then keeps the primary project action pointed at that conversation until a research brief is compiled and approved.
5. For connected repos, Forge fetches GitHub repo metadata, README, issues, and tree context.
6. A repo analysis agent inspects the connected repo and returns project knowledge plus evidence-backed opportunities.
7. Forge validates and stores signals, opportunities, evaluations, prototype records, agent tasks, research briefs, and pipeline run metadata.
8. The dashboard renders a product review: recommendation cards, evidence, decision rationale, and project memory.
9. The user can pass, watch, request research, refine, or approve a recommendation for build.
10. Build approval creates a build brief, records a preference event, and starts either a simulated builder or a managed Gemini builder when configured.
11. Build results are stored as `mvp_builds` and `build_artifacts`.
12. Reflection reviews feedback/build outcomes and stores auditable self-improvement proposals.

## What Works

- Next.js dashboard under `apps/dashboard`.
- Local JSON store fallback at `.forge-data/store.json`.
- Supabase schema migrations under `supabase/migrations`.
- Project onboarding for connected repos and new-product contexts.
- User/workspace ownership records for projects and related runtime records.
- GitHub App/OAuth connection records, install callback, server-side repo listing, project repo linking, and generated-repo target selection for new-product projects.
- AI-led idea conversations that compile structured research briefs when `GEMINI_API_KEY` is configured.
- New-product project headers route into the conversation and brief approval state instead of offering a generic Dream run before the AI/user interaction has produced an approved brief.
- Once a research conversation is complete, the next idea message starts a fresh AI/user direction instead of mutating the closed brief.
- Scheduled new-product runs wait for an approved AI brief instead of creating repeated waiting-for-brief runs.
- Approved-brief research shows phase-labeled agent progress for source collection, market research, taste critique, Bull/Bear review, decision, and build direction.
- Approved-brief research status includes the managed research evidence rollup, so the idea surface can show whether candidates are build-ready or still need more cited public evidence. Managed research candidates that do not clear the evidence gate remain in run metadata instead of being promoted into recommendation cards.
- GitHub repo discovery from public repos, project-linked GitHub App installation tokens, GitHub user OAuth tokens, or explicit local-dev fallback tokens.
- Gemini/Antigravity repo analysis when `GEMINI_API_KEY` is configured.
- Recommendation cards only when semantic discovery returns opportunities.
- Review actions that create preference events and update opportunity state.
- Build brief generation after human approval.
- Simulated builder for local, credential-free development.
- Managed Gemini builder path for returning file bundles or PR metadata.
- BuildReviewer checks for README, run instructions, smoke checks, MVP explanation, and free-service documentation.
- Reflection proposal generation from preference events and build outcomes.

## Known Gaps

- New-product discovery has the first managed research bridge for approved briefs. It still needs production scheduler/realtime hardening and broader source coverage.
- The Python managed-research service is separate from the dashboard Dream path and is not yet the default dashboard backend.
- Bull/Bear/Decision roles exist as contracts and stored evaluation shapes, but the dashboard repo-analysis path currently stores compact `taste_critic` and `decision_agent` evaluations, not a full multi-agent debate.
- Hosted Supabase and realtime are supported by contract, but local JSON remains the default development path.
- Managed builder behavior depends on live credentials and external API behavior.
- Generated MVPs are buildability evidence, not market validation.

## Documentation Map

- [Agent Instructions](./AGENTS.md) defines coding-agent rules for this repo.
- [Product Overview](./docs/PRODUCT_OVERVIEW.md) explains what Forge is, what exists now, and how to reason about product readiness.
- [System Architecture](./docs/ARCHITECTURE.md) separates current implementation from target architecture.
- [Agent System](./docs/AGENT_SYSTEM.md) lists the exact agent roles, current code paths, and planned gaps.
- [Data Model](./docs/DATA_MODEL.md) describes durable records and Supabase table contracts.
- [Frontend Backend Contract](./docs/FRONTEND_BACKEND_CONTRACT.md) defines dashboard/backend shape and API expectations.
- [Managed Trend Research Goal](./docs/MANAGED_TREND_RESEARCH_GOAL.md) covers the Python managed research slice.
- [Prompt Contracts](./docs/prompts/AGENT_PROMPTS.md) captures behavioral contracts for agent roles.
- [Docs Maintenance](./docs/DOCS_MAINTENANCE.md) defines when docs must be updated.
- [Open Questions](./docs/OPEN_QUESTIONS.md) tracks unresolved product and architecture decisions.

## Quick Start

```bash
pnpm install
pnpm setup
pnpm dev
```

Open `http://localhost:3000`.

Without Supabase credentials, the dashboard uses the gitignored local store at `.forge-data/store.json`.

## Useful Scripts

```bash
pnpm dev
pnpm test:contracts
pnpm test:managed-research
pnpm smoke:managed-research
pnpm typecheck
pnpm build
pnpm verify
pnpm supabase:migrate -- --env-file apps/dashboard/.env.local
pnpm runtime:secrets
```

The Python managed-research service has its own README at [services/managed_research/README.md](./services/managed_research/README.md).
Use `pnpm test:managed-research` from the repo root to run its fixture/API/schema contract tests through the locked
`uv` environment.
Use `pnpm smoke:managed-research` to start the real FastAPI service locally and verify the dashboard research client can
turn an approved brief response into dashboard signal/opportunity records.
Use `pnpm verify` for the full local proof bundle: dashboard contracts, managed-research contracts, typecheck, production
build, managed-research bridge smoke, and queued-worker smoke.

## Runtime Configuration

Local dashboard development works without managed-agent credentials. Set these only when exercising the live paths:

```text
GEMINI_API_KEY=
GITHUB_TOKEN= # Optional local-dev fallback only when FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 and FORGE_REQUIRE_AUTH is off
FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=0
FORGE_ENABLE_GITHUB_DEV_FALLBACK=0 # Optional manual installation-id form for local development only
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_STATE_SECRET=
GITHUB_STATE_MAX_AGE_SECONDS=900
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
FORGE_USER_ID=
FORGE_WORKSPACE_ID=
SUPABASE_ANON_KEY=
FORGE_AUTH_BEARER_COOKIE=
FORGE_PUBLIC_APP_URL=
FORGE_REQUIRE_AUTH=0
FORGE_ALLOWED_EMAILS=
FORGE_ALLOWED_EMAIL_DOMAINS=
FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=0
FORGE_TOKEN_ENCRYPTION_KEY=
FORGE_AUTH_SUBJECT=
FORGE_IDEA_COMPILER_AGENT=
FORGE_IDEA_COMPILER_TIMEOUT_MS=
FORGE_MANAGED_RESEARCH_URL=
FORGE_MANAGED_RESEARCH_SECRET=
FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH=0
FORGE_MANAGED_RESEARCH_TIMEOUT_MS=
FORGE_PIPELINE_WORKER_SECRET=
FORGE_BUILDER_ADAPTER=managed
FORGE_GEMINI_BUILDER_AGENT=antigravity-preview-05-2026
FORGE_REPO_ANALYSIS_AGENT=antigravity-preview-05-2026
FORGE_TEMPLATE_REPO_URL=
FORGE_GENERATED_REPO_OWNER=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL= # Local migration helper only; do not deploy as runtime config.
```

Do not expose service-role keys, GitHub tokens, raw managed-agent prompts, or generated-repo credentials to the browser.
For local or hosted smoke setup, generate missing local-only runtime secrets without printing them:

```bash
pnpm runtime:secrets
```

This fills only missing `FORGE_PIPELINE_WORKER_SECRET`, `GITHUB_STATE_SECRET`, and `FORGE_TOKEN_ENCRYPTION_KEY` values in
`apps/dashboard/.env.local`. Existing values are preserved.
Apply hosted schema changes with a Postgres database URL before running hosted storage smoke:

```bash
pnpm supabase:preflight -- --env-file apps/dashboard/.env.local
pnpm supabase:migrate -- --env-file apps/dashboard/.env.local --dry-run
pnpm supabase:migrate -- --env-file apps/dashboard/.env.local
pnpm smoke:runtime
```

`SUPABASE_SERVICE_ROLE_KEY` can read/write runtime rows through the API, but it cannot create missing tables. The migration
helper requires `SUPABASE_DB_URL`, checks that the DB URL targets the same Supabase project ref as `SUPABASE_URL`, skips
local editor conflict copies such as `* 2.*`, and stops on the first SQL error. Use `--skip-project-check` only after
manually verifying a nonstandard Postgres target.
Run `pnpm supabase:preflight -- --env-file apps/dashboard/.env.local` first to check hosted Supabase storage,
Auth/Realtime, DB URL, `psql`, and migration-file prerequisites without printing credential values.
When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, hosted dashboard requests can validate Supabase Auth bearer
headers or standard `sb-*-auth-token` cookies and map that auth subject to Forge user/workspace scope. `FORGE_USER_ID`,
`FORGE_WORKSPACE_ID`, and `FORGE_AUTH_SUBJECT` remain local/server-job overrides.
The built-in `/signup` and `/login` pages request Supabase Auth email magic links for the Forge account and store the returned access and refresh tokens in
httpOnly Forge session cookies after `/auth/callback` clears the token-bearing URL and validates the access token server-side. GitHub is connected later as a repo connector, not used as the primary Forge login. If the access cookie later
fails validation or expires, request-session validation can use the refresh cookie to obtain a fresh access token for that request. Set
`FORGE_PUBLIC_APP_URL` when the app is behind a proxy or deployed somewhere other than the current request host. Set
`FORGE_REQUIRE_AUTH=1` for hosted deployments so unauthenticated dashboard requests redirect to `/login` instead of
falling back to local/server identity. For private beta deployments, set `FORGE_ALLOWED_EMAILS` and/or
`FORGE_ALLOWED_EMAIL_DOMAINS`; Forge checks the allowlist before sending magic links and again after Supabase token
validation so a valid Supabase session cannot bypass the invite gate. With required auth enabled, repository identity resolution also rejects fallback
identity for direct server-action/data access unless `FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=1` is explicitly set
for a trusted background job.
Project settings render a runtime-readiness panel that shows capability state and missing environment variable names,
never secret values. When `FORGE_PUBLIC_APP_URL` is configured, it also shows exact non-secret provider setup URLs for
Supabase Auth, GitHub callbacks, GitHub webhooks, and the queued worker endpoint, with labels that separate configured-only
callback flows from live-proved health checks. That public app URL is required before those externally-called paths are treated as ready. The panel can also run server-side health checks for configured live paths such as managed research,
the pipeline worker bearer probe, GitHub App credentials plus a signed webhook `ping` probe, and the required Supabase schema tables. If
`FORGE_STORAGE_BACKEND=local` is set for fixture or rendered UI work, storage readiness reports the local override and
does not treat skipped Supabase probes as hosted proof.
Health detail text redacts configured secrets and bearer/access/refresh token patterns before it is returned to the browser or CLI.
Auth and GitHub callback messages follow the same boundary: callback UI and redirect query strings must not echo raw
provider bodies, token exchange failures, storage errors, or configured secret values.
The same non-secret health checks are available from the CLI:

```bash
pnpm smoke:runtime
FORGE_SMOKE_AUTH_BEARER=<supabase-access-token> pnpm smoke:runtime -- --strict
```

`--strict` fails unless every configured live path returns `ok`; without it, the smoke fails only on hard errors. The
script loads `apps/dashboard/.env.local` by default when run through pnpm's dashboard package context and never prints
raw credentials or token values. When any live path is non-ready, the CLI also prints a hosted setup handoff that groups
the missing pieces into concrete next actions, provider setup URLs, and remaining proof labels for Supabase storage/Auth, managed research, the worker probe, GitHub App,
and managed builder PR readiness. Use `--no-handoff` for terse smoke output.
If hosted storage is missing tables or columns, the storage check reports the schema as incomplete and points back to
`pnpm supabase:migrate` instead of treating service-role runtime credentials as migration credentials.
When Supabase URL and anon-key config are present and the request has a valid Supabase Auth session, project pages
subscribe to Supabase Realtime for project-scoped status tables using that short-lived access token and refresh
server-rendered details when a run, research task, opportunity, prototype, build, or reflection row changes. If the
socket cannot subscribe or no authenticated realtime token is available, Forge keeps the existing polling bridge as a fallback. Set
`FORGE_DISABLE_SUPABASE_REALTIME=1` to force polling.
Approving a research brief creates a durable queued `pipeline_runs` row plus queued agent tasks. The project page can run
the visible queued research immediately for interactive review, and hosted deployments should also call
`/api/pipeline/worker` with `Authorization: Bearer $FORGE_PIPELINE_WORKER_SECRET`. The worker accepts
`GET` requests from Vercel Cron to sweep the oldest queued research-brief runs. Each queued run is processed under the
owning project's user/workspace scope, so cron does not rely on a browser session or a single env-scoped workspace.
It also accepts `POST` with an explicit `{"projectId":"...","runId":"..."}` body for a known run, or an empty/`{"limit":5}`
body to sweep. `CRON_SECRET` is accepted as a worker secret fallback for hosts that already provide one; Vercel sends that
secret automatically on cron invocations when configured in the project environment.
To validate worker routing and auth without processing queued work, start the dashboard and run:

```bash
pnpm worker:probe -- --url http://127.0.0.1:3000
```

To prove the local approved-brief worker lifecycle without touching `.forge-data`, run:

```bash
pnpm smoke:worker-flow
```

That smoke creates an isolated temporary local store, queues an approved research brief, serves a local managed-research
fixture, runs the worker sweep, and asserts completed tasks plus stored source-backed signals and opportunities.

## Product Constraints

- Human approval is required before a generated-repo build.
- Generated MVP code should live in separate generated repos or PRs, not in this repo.
- V1 uses code, local execution, generated UI, and free services only.
- No paid APIs, production deploys, or secret-requiring integrations in generated MVPs unless a later explicit approval step changes that rule.
- Reflection improves Forge behavior; it does not create product opportunities by itself.
- Product recommendations must distinguish observed source evidence, manual input, model inference, and unknowns.
