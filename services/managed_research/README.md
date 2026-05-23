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

## Honest Limits

- Deep Research is best for cited reports, not guaranteed clean database rows.
- Antigravity is best for browsing, repo inspection, code execution, and file artifacts.
- Antigravity currently does not guarantee structured output, so Forge validates extracted JSON before saving.
- Source/API limits still apply. Use `GITHUB_TOKEN` for GitHub. Add source-specific auth when a public source becomes limiting.
- Bull/Bear/Synthesizer uses managed agents where available, but the deterministic clustering step should run first to avoid wasting quota on duplicate opportunities.
