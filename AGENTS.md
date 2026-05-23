# AGENTS.md

Primary instructions for AI coding agents working in this repository.

## Current State

The repo is a scaffold. Do not assume any implementation exists until you inspect the tree.

The product target is an agentic research pipeline that:

- Ingests public developer pain signals.
- Stores normalized signals and generated artifacts.
- Runs a bounded Bull vs. Bear critique loop.
- Produces sourced startup thesis drafts.
- Displays stored output in a dashboard.

## Engineering Priorities

1. Build local, testable execution before cloud deployment.
2. Prefer fewer reliable sources over broad scraping.
3. Preserve source URLs, timestamps, and provenance.
4. Validate model outputs before writing final records.
5. Keep generated prose separate from structured product data.
6. Avoid speculative infrastructure docs that cannot be run.

## Proposed Stack

- Python for ingestion, agents, debate orchestration, and Vertex deployment.
- Google ADK as the target agent framework.
- Vertex AI Agent Engine as the target hosted runtime.
- Supabase Postgres for data storage.
- Supabase Realtime for dashboard streaming.
- Next.js for frontend.
- Tailwind CSS and shadcn/ui for UI primitives.

Google ADK and Vertex AI Agent Engine APIs are version-sensitive. Verify package names and deployment code against current official docs when implementing.

## Repository Conventions

Use this structure unless there is a strong reason to diverge:

```text
apps/
  dashboard/         # Next.js app
services/
  agents/            # Python ADK agents and debate orchestration
  ingestion/         # Source clients and normalization
supabase/
  migrations/        # SQL schema and policies
docs/
  prompts/           # Agent prompt drafts
  adr/               # Architecture decision records only after real decisions
```

## Agent Roles

Keep the first implementation small. These roles are conceptual boundaries, not a requirement to create six independent remote agents on day one.

- `TrendScout`: extracts pain points and evidence from normalized signals.
- `ResearchAnalyst`: expands the evidence pack and identifies gaps.
- `MarketAnalyst`: frames buyer, alternatives, and willingness-to-pay hypotheses.
- `BullAgent`: argues the credible upside case.
- `BearAgent`: argues the credible downside case.
- `Synthesizer`: produces final Markdown and JSON thesis output.

## Coding Guidelines

- Start with fixture-based tests for parsers, schemas, and orchestration.
- Make ingestion idempotent where possible using source IDs or canonical URLs.
- Store raw enough source metadata to debug model output later.
- Keep debate messages append-only.
- Make each pipeline run identifiable.
- Never hardcode secrets, project IDs, API keys, or service account details.
- Do not present unsourced model claims as facts.

## Minimum Thesis Contract

Every generated thesis should include:

- Title.
- One-line thesis.
- Target user.
- Evidence summary with source references.
- Bull case.
- Bear case.
- MVP hypothesis.
- Distribution hypothesis.
- Risks and unknowns.
- Next validation steps.

## Safety And Data Rules

- Respect source terms and rate limits.
- Store only necessary public-source data.
- Avoid presenting speculative theses as financial advice.
- Keep service-role credentials server-side only.
