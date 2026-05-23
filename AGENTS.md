# AGENTS.md

Primary instructions for AI coding agents working in this repository.

## Current State

The repo is a scaffold. Do not assume any implementation exists until you inspect the tree.

The product target is a product-first agent system that:

- Supports connected products and new-product/sample project contexts.
- Ingests configured product inputs, public developer pain signals, manual ideas, repo/issues, feedback, and web/social research.
- Learns explicit user preferences plus behavior from approvals, rejections, ignored suggestions, prototype interactions, and build outcomes.
- Ranks product opportunities for a specific project and user.
- Runs taste critique, parallel Bull/Bear review, and a decision step before build.
- Surfaces morning/product reviews with evidence, critique, prototype options, and recommended next action.
- Starts a managed sandbox build after the user approves a direction.
- Produces generated UI, prototypes, or PR-ready MVPs in separate generated repositories.
- Reflects on failures and human feedback to improve Forge's own memory, rubrics, skills, prompts, scoring, and trigger policies.

## Engineering Priorities

1. Build local, testable contracts before live managed-sandbox integration.
2. Prefer manual ideas, fixtures, and one reliable configured source before broad scraping.
3. Preserve source URLs, timestamps, provenance, project context, human decisions, and manual-input origin.
4. Validate model outputs before writing final records.
5. Keep opportunity data, evaluations, decisions, prototypes, build briefs, build logs, generated artifacts, and reflection proposals separate.
6. Avoid speculative infrastructure docs that cannot be run.
7. Keep self-improvement versioned and auditable; do not silently mutate high-risk behavior.

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
  managed_research/  # Gemini managed-agent orchestration
  ingestion/         # Source clients and normalization
  builder/           # Simulated and managed builder adapters
  reflection/         # Forge self-improvement proposal generation
supabase/
  migrations/        # SQL schema and policies
fixtures/
  opportunities/     # User profiles, signals, opportunities, builds
docs/
  prompts/           # Agent prompt contracts
  adr/               # Architecture decision records only after real decisions
```

Generated MVP code should not live in this repo. It should be created in separate generated repos from a template repo. Lightweight generated UI schemas, prototype metadata, screenshots, and review artifacts may be stored as Forge records or artifacts.

## Agent Roles

Keep the first implementation small. These roles are conceptual boundaries, not a requirement to create multiple independent remote agents on day one.

- `SignalCollector`: gathers or accepts source items and manual ideas.
- `Researcher`: performs bounded web/social/source research and produces cited digests.
- `PreferenceModeler`: combines explicit profile data with behavior events.
- `OpportunityScout`: proposes and ranks product opportunities.
- `TasteCritic`: challenges product quality, coherence, differentiation, and taste fit.
- `BullAgent` and `BearAgent`: run in parallel to argue the strongest credible case for and against a candidate.
- `DecisionAgent`: recommends watch, research more, prototype, build, or reject.
- `BuildBriefGenerator`: turns an approved direction into an internal build brief.
- `ManagedBuilder`: runs in Antigravity sandbox, creates generated UI, prototypes, or generated repo MVPs, and opens a PR when requested.
- `BuildReviewer`: checks that the generated PR satisfies the minimum artifact contract.
- `ReflectionAgent`: reviews human feedback and failures to propose memory, rubric, skill, prompt, scoring, trigger, or eval-case improvements.

## Approval Contract

- A human approves only the direction or opportunity.
- After approval, Forge may choose stack, app structure, and implementation details.
- The builder must stay within the approved opportunity.
- The builder must use the template repo.
- The builder may use code and free services only.
- The builder must not use paid APIs, production deployments, or secret-requiring integrations in v1.
- Any free external service used by the generated MVP must be documented in the generated PR.

## Trigger And Review Contract

- Scheduled or autonomous runs are launched by Forge trigger records, not by assuming an always-on sandbox.
- Alerts should be decision-oriented: review ready, watched trend crossed threshold, prototype ready, competitor move, or human decision needed.
- Default autonomy should produce a morning/product review, not automatically build.
- Auto-prototype behavior must be configurable and must never bypass required human approval for generated repo builds in v1.

## Reflection Contract

- Reflection improves Forge's operating behavior; it does not create product opportunities by itself.
- Low-risk memory, preference, and source-weight updates may be auto-applied only when explicitly marked safe.
- Prompt, skill, rubric, trigger-policy, credential, destructive-action, and build-permission changes require review.
- Every reflection proposal must cite the prior feedback, ignored suggestion, failed build, noisy trigger, or repeated correction that motivated it.
- Reflection should add or update eval cases when it proposes behavior changes.

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
- Add fixture tests for project modes, source configs, trigger configs, decisions, prototype options, and reflection proposals.
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
