# Forge Managed Research

Managed-agent orchestration for Forge ingestion and research.

This service uses Gemini API managed agents through the Interactions API:

- Deep Research for cited research reports.
- Antigravity for web/repo inspection in a Google-managed sandbox.

Forge keeps Supabase writes outside the sandbox. Managed agents produce research text and JSON-like artifacts; Forge validates and saves records.

## Environment

```bash
GEMINI_API_KEY=
SUPABASE_URL=https://dumomlcpcehrqssrexjl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GITHUB_TOKEN= # Optional local-dev fallback only when FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 and FORGE_REQUIRE_AUTH is off
FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=0
FORGE_REDDIT_SUBREDDITS=LocalLLaMA,codex,ClaudeAI,OpenAI
FORGE_MANAGED_RESEARCH_SECRET=
FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH=0
```

`SUPABASE_SERVICE_ROLE_KEY` must stay server-side and must not be committed.

## Dry Run

Run commands from this directory through the locked `uv` environment:

```bash
uv run python -m tests.run_stdlib_tests
```

Single-stage research:

```bash
uv run python -m forge_managed_research.ingest \
  --topic "developer pain with AI agent deployment" \
  --agent antigravity \
  --dry-run
```

Two-stage trend-to-research pipeline:

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline trend-research \
  --topic "developer pain deploying AI agents to production" \
  --trend-agent antigravity \
  --research-agent antigravity \
  --dry-run
```

Cheap deterministic public collection:

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline source-collect \
  --topic "AI agents developer tools production pain" \
  --subreddits "LocalLLaMA,codex,ClaudeAI,OpenAI" \
  --stack-exchange-sites "stackoverflow,serverfault,superuser" \
  --limit-per-source 20 \
  --max-topics 5 \
  --max-opportunities 5 \
  --dry-run
```

Fixture-only validation:

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline seed-topics \
  --seed-input-file tests/fixtures/seed_output.md \
  --max-topics 2 \
  --dry-run
```

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline trend-research \
  --topic "fixture auth check" \
  --trend-input-file tests/fixtures/trend_output.md \
  --research-input-file tests/fixtures/research_output.md \
  --dry-run
```

## Save To Supabase

Hosted saves require the current root Supabase migration set, including the workspace/auth/GitHub/research tables used
by the dashboard contract. From the repo root, verify and apply them before expecting service writes to work:

```bash
pnpm supabase:preflight -- --env-file apps/dashboard/.env.local
pnpm supabase:migrate -- --env-file apps/dashboard/.env.local
```

The service writes source records into `pipeline_runs`, `signals`, `opportunities`, `opportunity_signals`, and
`opportunity_evaluations`, attached to a Forge project when `--project-id` is supplied. The dashboard owns user,
workspace, GitHub connection, idea conversation, build, realtime, and reflection tables.

```bash
uv run python -m forge_managed_research.ingest \
  --topic "developer pain with AI agent deployment" \
  --agent antigravity \
  --save
```

The trend-to-research pipeline stores retrieved media content and research findings in `pipeline_runs.metadata`, then stores normalized research-derived rows in `signals`, `opportunities`, `opportunity_signals`, and `opportunity_evaluations`.

Pass `--project-id <uuid>` with saved single-agent, trend-research, seed-topic, or source-collection runs to attach saved rows and run metadata to a Forge project.

For volume, run deterministic public collection first. It uses cheap public APIs for Hacker News, Reddit, Stack Exchange, and GitHub issues, stores collected media in `pipeline_runs.metadata`, and creates coarse seed topics, signals, and opportunities without spending managed-agent quota.

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline source-collect \
  --topic "AI agents developer tools production pain" \
  --subreddits "LocalLLaMA,codex,ClaudeAI,OpenAI" \
  --stack-exchange-sites "stackoverflow,serverfault,superuser" \
  --limit-per-source 25 \
  --max-topics 8 \
  --max-opportunities 8 \
  --trigger schedule \
  --save
```

When the user does not know what to investigate, seed topics first:

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline seed-topics \
  --topic "developer tool and AI product pain" \
  --max-topics 5 \
  --save
```

Or run seeded topics through the trend-to-research pipeline:

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline auto-trend-research \
  --topic "developer tool and AI product pain" \
  --max-topics 3 \
  --save
```

```bash
uv run python -m forge_managed_research.ingest \
  --pipeline trend-research \
  --topic "developer pain deploying AI agents to production" \
  --trend-agent antigravity \
  --research-agent antigravity \
  --save
```

## Cluster And Evaluate Opportunities

Raw opportunities are coarse and may duplicate each other. Cluster them before spending managed-agent quota on debate:

```bash
uv run python -m forge_managed_research.evaluate \
  --mode cluster \
  --max-opportunities 100 \
  --max-clusters 5 \
  --save
```

Then run Bull/Bear/Decision/Synthesizer on a canonical cluster:

```bash
uv run python -m forge_managed_research.evaluate \
  --mode bull-bear \
  --cluster-index 0 \
  --save
```

The evaluation flow is:

```text
opportunities -> canonical opportunity clusters -> BullAgent -> BearAgent -> DecisionAgent -> Synthesizer
```

Cluster packets are saved in `pipeline_runs.metadata`. Bull, Bear, Decision, and Synthesizer outputs are saved to `opportunity_evaluations` on the representative opportunity. The Synthesizer creates:

- a concise product pitch
- MVP scope and non-goals
- a builder system prompt for the later managed sandbox build
- builder readiness: `ready` or `not_ready`

Fixture-only validation, without managed-agent calls:

```bash
uv run python -m forge_managed_research.evaluate \
  --mode bull-bear \
  --cluster-index 0 \
  --evaluation-input-file tests/fixtures/bull_bear_output.md \
  --dry-run
```

## Dashboard API

Run the backend API locally:

```bash
uv run uvicorn forge_managed_research.api:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

Run an approved dashboard research brief synchronously and return normalized records for the dashboard to persist:

```bash
curl -X POST http://localhost:8000/api/research-briefs/run \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer shared-dev-secret' \
  -d '{
    "project": {"name": "Screenshot helper"},
    "research_brief": {
      "hypothesis": "Solo iOS developers need a lighter App Store screenshot workflow",
      "target_users": ["solo iOS developers"],
      "pain_area": "App Store screenshot production is repetitive",
      "constraints": ["no paid APIs"],
      "source_plan": ["GitHub issues and public developer discussions"],
      "disqualifying_evidence": ["Existing free tools solve the whole workflow"],
      "mvp_boundaries": ["local screenshot planner"],
      "user_taste_notes": ["local-first and quiet workflow"],
      "open_questions": []
    }
  }'
```

Every `/api/*` route requires `Authorization: Bearer <FORGE_MANAGED_RESEARCH_SECRET>` by default. `/health` remains unauthenticated for readiness checks. For local throwaway development only, set `FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH=1` to run `/api/*` routes without a bearer secret.

Dashboard brief-research calls include the project owner/workspace in `X-Forge-User-Id` and `X-Forge-Workspace-Id` plus the project payload. The service echoes the resolved `request_scope` in the research response so the dashboard can persist which user/workspace scope produced the run. Brief constraints, disqualifying evidence, MVP boundaries, user taste notes, and open questions are included in the search query and preserved on synthesized opportunity profiles for auditability. The brief `source_plan` also routes deterministic collection: explicit GitHub, Reddit, Hacker News, and Stack Exchange mentions limit collection to those collectors, `r/<subreddit>` mentions become Reddit targets, and Stack Exchange site mentions become site targets. Generic source plans keep the broad default collectors. Synthesized opportunity profiles also include `linked_signal_count`, `cited_signal_count`, `evidence_sufficient_for_build`, and `evidence_sufficiency_reason`, and the response includes an `evidence_summary` rollup. The Bull/Bear/Decision/Synthesizer packet and fallback evaluation receive that context so critique and builder prompts stay grounded in the approved conversation; fallback synthesis marks builder output `not_ready` and leaves the builder prompt blank unless public evidence explicitly clears the build-readiness gate.
The dashboard promotes only opportunities whose profile sets `evidence_sufficient_for_build` to `true`; thin candidates remain in managed-run metadata as unpromoted research output.

Legacy project/opportunity API routes are scoped by `X-Forge-User-Id` and `X-Forge-Workspace-Id` request headers, falling back to `FORGE_USER_ID` and `FORGE_WORKSPACE_ID` when the headers are absent. Project creation writes that scope to `projects.owner_user_id` and `projects.workspace_id`; project reads and raw-id project assertions include the same scope filters. Raw opportunity detail, action, and build routes require the opportunity to belong to a project that is visible in that scope; project-less legacy opportunities are hidden from those routes.

The API implements the project-scoped dashboard contract in `docs/FRONTEND_BACKEND_CONTRACT.md`:

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `PATCH /api/projects/{project_id}`
- `POST /api/projects/{project_id}/brainstorm`
- `POST /api/projects/{project_id}/import-github`
- `POST /api/projects/{project_id}/runs`
- `GET /api/projects/{project_id}/runs`
- `GET /api/runs/{run_id}`
- `GET /api/projects/{project_id}/opportunities`
- `GET /api/opportunities/{opportunity_id}`
- `POST /api/opportunities/{opportunity_id}/actions`
- `POST /api/opportunities/{opportunity_id}/builds`
- `GET /api/builds/{build_id}`

Long-running project analysis, discovery, and build work is launched as FastAPI background tasks. The frontend should render the returned `in_progress` records and refresh via polling or Supabase Realtime.

Discovery runs use deterministic public collection first, then opportunity clustering. By default, the backend uses the fast local source-research and fallback Bull/Bear/Synthesizer path so the dashboard always receives recommended opportunities. Enable managed research/evaluation explicitly when quota and latency allow:

```bash
FORGE_ENABLE_DEEP_RESEARCH=1
FORGE_RESEARCH_AGENT=antigravity
FORGE_ENABLE_MANAGED_EVAL=1
```

Use `FORGE_RESEARCH_AGENT=deep-research` only when a slow cited report is worth waiting for. Deep Research can take many minutes. Managed-agent failures are stored as non-blocking metadata and the pipeline continues with local fallback artifacts.

Build records prepare and persist the Antigravity builder prompt context required by the contract. By default the endpoint records deterministic simulated PR metadata so local dashboard flows stay runnable. Enable the real Gemini managed builder explicitly when the target repo and credentials are ready:

```bash
FORGE_ENABLE_MANAGED_BUILDER=1
GEMINI_API_KEY=...
```

The managed builder is instructed to build in the project `repo_url`, open a PR titled `Build MVP: <opportunity title>`, and return JSON PR metadata for validation before Forge marks the build complete.

## Honest Limits

- Deep Research is best for cited reports, not guaranteed clean database rows.
- Antigravity is best for browsing, repo inspection, code execution, and file artifacts.
- Antigravity currently does not guarantee structured output, so Forge validates extracted JSON before saving.
- Source/API limits still apply. Stack Exchange collection uses the public `/search/advanced` API with `filter=withbody` and no credentials. GitHub collection uses a request-scoped `github_access_token` when the dashboard forwards a short-lived GitHub App/OAuth token for a connected project. `GITHUB_TOKEN`/`FORGE_GITHUB_TOKEN` is ignored unless `FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1` is set for local development, and remains ignored when `FORGE_REQUIRE_AUTH=1`.
- Bull/Bear/Synthesizer uses managed agents where available, but the deterministic clustering step should run first to avoid wasting quota on duplicate opportunities.
- Dashboard persistence needs the current root migration set applied; run `pnpm supabase:preflight` from the repo root before hosted saves.
- The Antigravity build endpoint validates that a PR URL is returned before marking a managed build complete.
