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
apps/dashboard/app/actions/pipeline.ts
  -> apps/dashboard/lib/pipeline.ts
  -> apps/dashboard/lib/ideas/new-product-discovery.ts
  -> apps/dashboard/lib/db/repository.ts
```

Current behavior:

1. Forge records manual preference and demo-constraint signals.
2. Forge creates no opportunity cards.
3. The dashboard shows that context was collected and recommendations need model-backed discovery.

This is intentionally incomplete. The next product slice should add an agent-backed `NewProductDiscoveryAgent` rather than returning hardcoded templates.

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
2. Forge creates a build brief from the opportunity, project, evidence, and evaluations.
3. Forge updates the opportunity to `building`.
4. Forge creates an `mvp_builds` row.
5. Forge records a preference event of type `approved`.
6. If the managed builder is configured, Forge invokes the Gemini managed builder.
7. Otherwise Forge uses the simulated builder.
8. Build artifacts are reviewed before completion.

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
- Writes to Supabase from Forge-controlled code.
- Keeps managed agents responsible for research artifacts, not direct database mutation.

This service is not yet the default dashboard pipeline backend.

## Agent Roles

### Implemented Or Partially Implemented

- `RepoAnalysisAgent`: implemented through `repo-analysis-agent.ts`. Inspects an attached repo and returns project knowledge plus opportunities.
- `SignalCollector`: implemented in local forms, GitHub repo discovery, and the Python managed research collectors.
- `PreferenceModeler`: partially implemented through preference records, preference events, and `preference-ranking.ts`.
- `DecisionAgent`: partially represented as stored `decision_agent` evaluations on opportunities.
- `BuildBriefGenerator`: implemented in `build/brief.ts`.
- `ManagedBuilder`: implemented as `managed-gemini-builder.ts` with a simulated fallback.
- `BuildReviewer`: implemented in `build/reviewer.ts`.
- `ReflectionAgent`: implemented as a deterministic proposal engine in `reflection-engine.ts`.

### Contracted But Not Fully Implemented

- `NewProductDiscoveryAgent`: needed for new-product recommendations.
- `Researcher`: exists in the Python managed-research path, not as the default dashboard flow.
- `OpportunityScout`: distributed across repo analysis output, local synthesis, and preference ranking.
- `TasteCritic`: currently compact and often derived from model rationale; needs fuller critique.
- `BullAgent` and `BearAgent`: present in prompt/service contracts; not yet first-class in dashboard repo-analysis flow.
- `DecisionAgent`: needs richer recommendations and required constraints.
- `Synthesizer`: present in managed-research contracts; not yet a first-class dashboard artifact.

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

The next agent to build should be `NewProductDiscoveryAgent`.

Minimum acceptable behavior:

1. Accept project description, preference profile, manual notes, and optional seed idea.
2. Retrieve or cite bounded evidence, or explicitly mark a recommendation as manual-origin only.
3. Return validated opportunities with score rationale and evidence links.
4. Store no opportunity when evidence and context are insufficient.
5. Produce useful empty-state metadata instead of fake recommendation cards.
