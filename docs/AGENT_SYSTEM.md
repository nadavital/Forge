# Agent System

This document describes the agent roles Forge is designed around and the exact paths that exist in the current repo.

## Current Executable Agent Paths

### Connected Repo Dream

Code path:

```text
apps/dashboard/app/actions/pipeline.ts
  -> apps/dashboard/lib/pipeline.ts
  -> apps/dashboard/lib/github/repo-discovery.ts
  -> apps/dashboard/lib/github/repo-analysis-agent.ts
  -> apps/dashboard/lib/scoring/preference-ranking.ts
  -> apps/dashboard/lib/db/repository.ts
```

Runtime flow:

1. The dashboard invokes `runProjectPipeline(projectId)`.
2. `triggerProjectPipeline` runs `runReflection` first.
3. Forge loads the project bundle from local JSON or Supabase.
4. If the project has a repo URL, Forge fetches GitHub repo metadata, README, recent issues, and a bounded recursive tree.
5. Forge creates source `signals` from repo and issue evidence.
6. `runAntigravityRepoAnalysis` sends the repo plus an inline instruction file to the Gemini Interactions API.
7. The managed repo-analysis agent must return strict JSON containing `project_knowledge` and `opportunities`.
8. Forge normalizes knowledge and opportunities, links opportunities to signals, and stores compact `taste_critic` and `decision_agent` evaluations.
9. Preference ranking adjusts opportunity order using stored preference events and user preferences.
10. Forge completes the pipeline run with digest metadata and project knowledge.

Failure behavior:

- If the repo analysis fails, the pipeline run is marked failed.
- Forge does not create deterministic fallback recommendations.
- Empty recommendations are allowed when semantic discovery does not produce evidence-backed opportunities.

### New-Product Dream

Code path:

```text
apps/dashboard/components/ideas/IdeaIntakePanel.tsx
  -> apps/dashboard/app/actions/idea.ts
  -> apps/dashboard/lib/ideas/idea-conversation.ts
apps/dashboard/app/actions/pipeline.ts
  -> apps/dashboard/lib/pipeline.ts
  -> apps/dashboard/lib/ideas/new-product-discovery.ts
  -> apps/dashboard/lib/db/repository.ts
```

Current behavior:

1. The user can talk naturally through a product direction.
2. When `GEMINI_API_KEY` is configured, the intake agent compiles the transcript into a validated `research_brief`.
3. The user approves the brief before research runs. A `ready_for_research` brief is only an intake output; research agents may run only after the brief is marked `approved`. Model output is downgraded to `needs_context` until it includes the hypothesis, target users, pain area, source plan, disqualifying evidence, and MVP boundaries. If the model omits open questions while claiming readiness, the fallback follow-up is derived from the transcript and capped at one or two prompts rather than exposing a fixed questionnaire. If the idea compiler is missing or fails, Forge still stores a non-approvable draft with conversation-derived product follow-ups; config or compiler errors are preserved as constraints/audit context, not as the user's next prompt.
4. Forge queues role-specific `agent_tasks` for SourceCollector, Researcher, TasteCritic, BullAgent, BearAgent, DecisionAgent, and Synthesizer. Each task prompt carries the brief hypothesis plus conversation-derived constraints, user taste notes, source plan, disqualifying evidence, MVP boundaries, and remaining uncertainty.
5. If `FORGE_MANAGED_RESEARCH_URL` and `FORGE_MANAGED_RESEARCH_SECRET` are configured, Forge sends the brief to the managed research service and stores returned public-source signals, candidate opportunities, evaluator-role metadata, evidence sufficiency rollups, and Bull/Bear/Decision/Synthesizer-shaped evaluations.
6. In hosted auth-required mode, missing managed research configuration fails the run and returns the brief to `approved` instead of creating brief-origin market-research cards.
7. Managed research candidates are promoted into dashboard opportunity cards only when their profile says `evidence_sufficient_for_build = true`. Thin candidates remain in pipeline-run metadata as unpromoted research output.
8. In local development without the backend, Forge records the approved brief as a signal and creates hypothesis opportunity records marked `researching`.
9. Without an approved brief, Forge records a waiting run and does not replace existing source-backed signals or opportunities.

Brief-origin hypothesis cards are not market evidence. Source-collected candidates can carry fallback Bull/Bear/Decision/Synthesizer evaluations, but Forge should still show uncertainty and avoid treating them as market validation. Fallback synthesis must mark builder output `not_ready` unless the candidate explicitly clears the linked/cited evidence gate.

### Build Approval And Builder

Code path:

```text
apps/dashboard/app/actions/build.ts
  -> apps/dashboard/lib/build/builder.ts
  -> apps/dashboard/lib/build/brief.ts
  -> apps/dashboard/lib/build/managed-gemini-builder.ts
  -> apps/dashboard/lib/simulated-builder.ts
  -> apps/dashboard/lib/build/reviewer.ts
```

Runtime flow:

1. The user approves an opportunity by clicking Build.
2. Forge checks that the opportunity has sufficient source-collected or repo evidence and a `prototype` or `build` decision recommendation. Source-collected market opportunities need at least two linked source signals and one cited URL; repo-evidence opportunities need at least one linked repo signal.
3. Forge rejects brief-only hypotheses, manual-only context, unknown evidence, and `research_more`/`watch`/`reject` decisions before any build row is created.
4. Forge creates a build brief from the opportunity, project, evidence, and evaluations.
5. Forge updates the opportunity to `building`.
6. Forge creates an `mvp_builds` row.
7. Forge records a preference event of type `approved`.
8. If the managed builder is configured, Forge invokes the Gemini managed builder.
9. Otherwise Forge uses the simulated builder.
10. Build artifacts are reviewed before completion.

Managed builder behavior:

- The agent receives a compact build brief.
- The agent must return either PR metadata or a `files[]` bundle.
- If files are returned, Forge creates the branch/repo/PR server-side using GitHub credentials.
- The sandbox must not receive GitHub tokens or service-role credentials.

### Reflection

Code path:

```text
apps/dashboard/lib/reflection/reflection-engine.ts
  -> apps/dashboard/lib/db/repository.ts
```

Current behavior:

1. Forge reads preference events and build records.
2. It creates evidence summaries.
3. It stores reflection proposals for rubric, scoring, preference, or eval-case updates.
4. It does not directly mutate high-risk behavior.

Reflection is not product research and must not generate product opportunities.

### Managed Research Service

Code path:

```text
services/managed_research/forge_managed_research/ingest.py
services/managed_research/forge_managed_research/interactions.py
services/managed_research/forge_managed_research/collectors.py
services/managed_research/forge_managed_research/local_synthesis.py
services/managed_research/forge_managed_research/evaluate.py
services/managed_research/forge_managed_research/supabase.py
```

Current behavior:

- Provides a Python CLI for source collection, trend research, topic seeding, local synthesis, clustering, and Bull/Bear-style evaluation.
- Deterministic source collection currently uses public Hacker News, Reddit, Stack Exchange, and GitHub issue APIs before managed-agent synthesis.
- Approved-brief synthesis reports evidence sufficiency on each opportunity and as a response rollup; fallback Decision output recommends `research_more` instead of `prototype` when linked/cited evidence is still below the build-readiness bar, and fallback Synthesizer output leaves builder prompts `not_ready` unless `evidence_sufficient_for_build` is explicitly true. The dashboard uses that rollup in Researcher, Decision, and Synthesizer task summaries so a completed task can still say the product decision is to collect more evidence.
- Writes to Supabase from Forge-controlled code.
- Keeps managed agents responsible for research artifacts, not direct database mutation.

This service is not yet the default dashboard pipeline backend.

## Agent Roles

### Implemented Or Partially Implemented

- `RepoAnalysisAgent`: implemented through `repo-analysis-agent.ts`. Inspects an attached repo and returns project knowledge plus opportunities.
- `IdeaIntakeAgent`: implemented through `idea-conversation.ts`. Drives the AI/user conversation and compiles research briefs.
- `SignalCollector`: implemented in local forms, GitHub repo discovery, and the Python managed research collectors.
- `Researcher`: implemented in the Python managed-research path for approved research briefs.
- `PreferenceModeler`: partially implemented through preference records, preference events, and `preference-ranking.ts`.
- `DecisionAgent`: partially represented as stored `decision_agent` evaluations on opportunities.
- `Synthesizer`: first-class for approved-brief task tracking, opportunity build-direction display, and build-brief prompts when managed research returns `synthesizer_agent` evaluations.
- `BuildBriefGenerator`: implemented in `build/brief.ts`.
- `ManagedBuilder`: implemented as `managed-gemini-builder.ts` with a simulated fallback.
- `BuildReviewer`: implemented in `build/reviewer.ts`.
- `ReflectionAgent`: implemented as a deterministic proposal engine in `reflection-engine.ts`.

### Contracted But Not Fully Implemented

- `NewProductDiscoveryAgent`: partially represented by brief-origin hypothesis records; still needs managed source research before source-backed recommendations.
- `OpportunityScout`: distributed across repo analysis output, local synthesis, and preference ranking.
- `TasteCritic`: currently compact and often derived from model rationale; needs fuller critique.
- `BullAgent` and `BearAgent`: present in prompt/service contracts; not yet first-class in dashboard repo-analysis flow.
- `DecisionAgent`: needs richer recommendations and required constraints.

## Agent Output Rules

All agent outputs that become durable product records must:

- Preserve evidence IDs, URLs, timestamps, or manual-input origin.
- Distinguish observed evidence from inference.
- Prefer `unknown` over invented facts.
- Validate before writes.
- Avoid paid APIs, production deploys, and secret-requiring services for v1 generated MVPs.
- Keep generated MVPs framed as prototypes, not market validation.

## Approval Boundary

The user approves only the opportunity or direction.

After approval, Forge may choose stack, app structure, and implementation details inside the build contract. The builder must stay inside the approved opportunity and must not require further hidden approvals for paid APIs, production deploys, secrets, or destructive actions.

## Next Agent Work

The next agent work should harden approved-brief evaluation with live managed agents, stronger hosted scheduler proof, and better UI surfacing.

Minimum acceptable behavior:

1. Accept a validated `research_brief`.
2. Run source collection and bounded research from the brief's `source_plan`.
3. Preserve source URLs, timestamps, and observed-vs-inferred evidence state.
4. Run Taste/Bull/Bear/Decision/Synthesizer evaluation or a transparent fallback when managed agents are disabled.
5. Promote a brief-origin hypothesis only when evidence is strong enough.
6. Store no recommended opportunity when evidence and context are insufficient.
