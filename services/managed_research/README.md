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
GITHUB_TOKEN=
```

`SUPABASE_SERVICE_ROLE_KEY` must stay server-side and must not be committed.

## Dry Run

Single-stage research:

```bash
python -m forge_managed_research.ingest \
  --topic "developer pain with AI agent deployment" \
  --agent antigravity \
  --dry-run
```

Two-stage trend-to-research pipeline:

```bash
python -m forge_managed_research.ingest \
  --pipeline trend-research \
  --topic "developer pain deploying AI agents to production" \
  --trend-agent antigravity \
  --research-agent antigravity \
  --dry-run
```

Cheap deterministic public collection:

```bash
python -m forge_managed_research.ingest \
  --pipeline source-collect \
  --topic "AI agents developer tools production pain" \
  --limit-per-source 20 \
  --max-topics 5 \
  --max-opportunities 5 \
  --dry-run
```

Fixture-only validation:

```bash
python -m forge_managed_research.ingest \
  --pipeline seed-topics \
  --seed-input-file tests/fixtures/seed_output.md \
  --max-topics 2 \
  --dry-run
```

```bash
python -m forge_managed_research.ingest \
  --pipeline trend-research \
  --topic "fixture auth check" \
  --trend-input-file tests/fixtures/trend_output.md \
  --research-input-file tests/fixtures/research_output.md \
  --dry-run
```

## Save To Supabase

Supabase migration has already been applied for the first persistence slice:

- `pipeline_runs`
- `signals`
- `opportunities`
- `opportunity_signals`
- `opportunity_evaluations`

For the dashboard API contract, also apply:

```text
supabase/migrations/0002_dashboard_contract.sql
```

It adds project, schedule, run, action, and build tables, plus nullable `project_id` links on existing ingestion records.

```bash
python -m forge_managed_research.ingest \
  --topic "developer pain with AI agent deployment" \
  --agent antigravity \
  --save
```

The trend-to-research pipeline stores retrieved media content and research findings in `pipeline_runs.metadata`, then stores normalized research-derived rows in `signals`, `opportunities`, `opportunity_signals`, and `opportunity_evaluations`.

For volume, run deterministic public collection first. It uses cheap public APIs, stores collected media in `pipeline_runs.metadata`, and creates coarse seed topics, signals, and opportunities without spending managed-agent quota.

```bash
python -m forge_managed_research.ingest \
  --pipeline source-collect \
  --topic "AI agents developer tools production pain" \
  --limit-per-source 25 \
  --max-topics 8 \
  --max-opportunities 8 \
  --save
```

When the user does not know what to investigate, seed topics first:

```bash
python -m forge_managed_research.ingest \
  --pipeline seed-topics \
  --topic "developer tool and AI product pain" \
  --max-topics 5 \
  --save
```

Or run seeded topics through the trend-to-research pipeline:

```bash
python -m forge_managed_research.ingest \
  --pipeline auto-trend-research \
  --topic "developer tool and AI product pain" \
  --max-topics 3 \
  --save
```

```bash
python -m forge_managed_research.ingest \
  --pipeline trend-research \
  --topic "developer pain deploying AI agents to production" \
  --trend-agent antigravity \
  --research-agent antigravity \
  --save
```

## Cluster And Evaluate Opportunities

Raw opportunities are coarse and may duplicate each other. Cluster them before spending managed-agent quota on debate:

```bash
python -m forge_managed_research.evaluate \
  --mode cluster \
  --max-opportunities 100 \
  --max-clusters 5 \
  --save
```

Then run Bull/Bear/Decision/Synthesizer on a canonical cluster:

```bash
python -m forge_managed_research.evaluate \
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
python -m forge_managed_research.evaluate \
  --mode bull-bear \
  --cluster-index 0 \
  --evaluation-input-file tests/fixtures/bull_bear_output.md \
  --dry-run
```

## Dashboard API

Run the backend API locally:

```bash
uvicorn forge_managed_research.api:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

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
- Source/API limits still apply. Use `GITHUB_TOKEN` for GitHub. Add source-specific auth when a public source becomes limiting.
- Bull/Bear/Synthesizer uses managed agents where available, but the deterministic clustering step should run first to avoid wasting quota on duplicate opportunities.
- The dashboard API needs `0002_dashboard_contract.sql` applied before project routes can persist data.
- The Antigravity build endpoint validates that a PR URL is returned before marking a managed build complete.
