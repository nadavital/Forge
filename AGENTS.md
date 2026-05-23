# AGENTS.md

Primary instructions for AI coding agents working in this repository.

## Current State

The repo is a scaffold. Do not assume any implementation exists until you inspect the tree.

The product target is a preference-aware MVP builder that:

- Ingests public developer pain signals and manual product ideas.
- Learns explicit user preferences plus behavior from approvals, rejections, and build outcomes.
- Ranks product opportunities for a specific user.
- Starts a managed sandbox build after the user approves an opportunity.
- Produces a PR-ready MVP in a separate generated repository.

## Engineering Priorities

1. Build local, testable contracts before live managed-sandbox integration.
2. Prefer manual ideas and fixtures before broad scraping.
3. Preserve source URLs, timestamps, provenance, and manual-input origin.
4. Validate model outputs before writing final records.
5. Keep opportunity data, build briefs, build logs, and generated artifacts separate.
6. Avoid speculative infrastructure docs that cannot be run.

## Proposed Stack

- Python for ingestion, opportunity ranking, agent orchestration, and managed builder adapters.
- Google ADK as the target agent framework.
- Vertex AI Agent Engine as the target hosted runtime if it fits the final deployment path.
- Antigravity as the target managed sandbox builder.
- Supabase Postgres for data storage.
- Supabase Realtime for dashboard streaming.
- Next.js for the internal dashboard.
- A minimal template repo for generated MVP apps.

Google ADK, Vertex AI Agent Engine, and Antigravity APIs are version-sensitive. Verify package names, permissions, and deployment code against current official docs when implementing.

## Repository Conventions

Use this structure unless there is a strong reason to diverge:

```text
apps/
  dashboard/         # Internal Forge dashboard
services/
  agents/            # Agent orchestration and prompt contracts
  ingestion/         # Source clients and normalization
  builder/           # Simulated and managed builder adapters
supabase/
  migrations/        # SQL schema and policies
fixtures/
  opportunities/     # User profiles, signals, opportunities, builds
docs/
  prompts/           # Agent prompt contracts
  adr/               # Architecture decision records only after real decisions
```

Generated MVP code should not live in this repo. It should be created in separate generated repos from a template repo.

## Agent Roles

Keep the first implementation small. These roles are conceptual boundaries, not a requirement to create multiple independent remote agents on day one.

- `SignalCollector`: gathers or accepts source items and manual ideas.
- `PreferenceModeler`: combines explicit profile data with behavior events.
- `OpportunityScout`: proposes and ranks MVP opportunities.
- `Critic`: challenges feasibility, usefulness, scope, and evidence quality.
- `BuildBriefGenerator`: turns an approved opportunity into an internal build brief.
- `ManagedBuilder`: runs in Antigravity sandbox, creates the generated repo MVP, and opens a PR.
- `BuildReviewer`: checks that the generated PR satisfies the minimum artifact contract.

## Approval Contract

- A human approves only the opportunity.
- After approval, Forge may choose stack, app structure, and implementation details.
- The builder must stay within the approved opportunity.
- The builder must use the template repo.
- The builder may use code and free services only.
- The builder must not use paid APIs, production deployments, or secret-requiring integrations in v1.
- Any free external service used by the generated MVP must be documented in the generated PR.

## Generated PR Contract

Every generated MVP PR must include:

- Runnable app code.
- README with setup and run instructions.
- Basic tests or smoke checks.
- Explanation of the product MVP.
- List of free external services used, if any.

PR title format:

```text
Build MVP: <opportunity title>
```

## Coding Guidelines

- Start with fixture-based tests for profiles, scoring, schemas, build briefs, and build state transitions.
- Make ingestion idempotent where possible using source IDs or canonical URLs.
- Make each pipeline run and build run identifiable.
- Store raw enough metadata to debug opportunity ranking and builder behavior later.
- Never hardcode secrets, project IDs, API keys, service account details, or generated-repo credentials.
- Do not present unsourced model claims as facts.

## Safety And Data Rules

- Respect source terms and rate limits.
- Store only necessary public-source data.
- Keep service-role credentials server-side only.
- Treat generated MVPs as prototypes, not production software.
- Treat generated MVPs as evidence of buildability, not proof of market demand.
