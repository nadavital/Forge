# Forge

Forge is a product-first agent system for turning project context, source evidence, and user taste into reviewed product opportunities and approved prototype or MVP build work.

The current repository is an early vertical slice, not just a scaffold. It includes a Next.js dashboard, local/Supabase storage contracts, connected-repo discovery, semantic repo analysis through a Gemini/Antigravity-style agent path, opportunity review actions, build brief generation, simulated and managed builder adapters, and a simple reflection proposal loop.

Forge is still not a complete autonomous product-discovery platform. The strongest current path is connected-product review from a GitHub repo. New-product mode captures context and signals, but it does not yet create agent-backed recommendations without a real discovery/research step.

## Current Product Shape

Forge currently behaves like a product review and build-orchestration workbench:

1. Create a connected-product or new-product project.
2. Store explicit product context, source configs, triggers, and user preferences.
3. Run Dream for a project.
4. For connected repos, Forge fetches GitHub repo metadata, README, issues, and tree context.
5. A repo analysis agent inspects the connected repo and returns project knowledge plus evidence-backed opportunities.
6. Forge validates and stores signals, opportunities, evaluations, prototype records, and pipeline run metadata.
7. The dashboard renders a product review: recommendation cards, evidence, decision rationale, and project memory.
8. The user can pass, watch, request research, refine, or approve a recommendation for build.
9. Build approval creates a build brief, records a preference event, and starts either a simulated builder or a managed Gemini builder when configured.
10. Build results are stored as `mvp_builds` and `build_artifacts`.
11. Reflection reviews feedback/build outcomes and stores auditable self-improvement proposals.

## What Works

- Next.js dashboard under `apps/dashboard`.
- Local JSON store fallback at `.forge-data/store.json`.
- Supabase schema migrations under `supabase/migrations`.
- Project onboarding for connected repos and new-product contexts.
- GitHub repo discovery from public repos, with optional `GITHUB_TOKEN` for higher limits or private repos.
- Gemini/Antigravity repo analysis when `GEMINI_API_KEY` is configured.
- Recommendation cards only when semantic discovery returns opportunities.
- Review actions that create preference events and update opportunity state.
- Build brief generation after human approval.
- Simulated builder for local, credential-free development.
- Managed Gemini builder path for returning file bundles or PR metadata.
- BuildReviewer checks for README, run instructions, smoke checks, MVP explanation, and free-service documentation.
- Reflection proposal generation from preference events and build outcomes.

## Known Gaps

- New-product discovery needs a real agent-backed research path before it can create recommendations.
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
pnpm typecheck
pnpm build
```

The Python managed-research service has its own README at [services/managed_research/README.md](./services/managed_research/README.md).

## Runtime Configuration

Local dashboard development works without managed-agent credentials. Set these only when exercising the live paths:

```text
GEMINI_API_KEY=
GITHUB_TOKEN=
FORGE_BUILDER_ADAPTER=managed
FORGE_GEMINI_BUILDER_AGENT=antigravity-preview-05-2026
FORGE_REPO_ANALYSIS_AGENT=antigravity-preview-05-2026
FORGE_TEMPLATE_REPO_URL=
FORGE_GENERATED_REPO_OWNER=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Do not expose service-role keys, GitHub tokens, raw managed-agent prompts, or generated-repo credentials to the browser.

## Product Constraints

- Human approval is required before a generated-repo build.
- Generated MVP code should live in separate generated repos or PRs, not in this repo.
- V1 uses code, local execution, generated UI, and free services only.
- No paid APIs, production deploys, or secret-requiring integrations in generated MVPs unless a later explicit approval step changes that rule.
- Reflection improves Forge behavior; it does not create product opportunities by itself.
- Product recommendations must distinguish observed source evidence, manual input, model inference, and unknowns.
