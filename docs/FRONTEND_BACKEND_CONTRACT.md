# Frontend Backend Contract

This is the source of truth for connecting the Forge dashboard to the managed-agent backend.

Forge is a single-user hackathon product for now. It should still be project-scoped so the product can later support real users, teams, and multiple active apps without rewriting the core flow.

## Product Flow

```text
project setup
  -> repo/context analysis
  -> scheduled or manual discovery run
  -> signal collection
  -> opportunity clustering
  -> Bull/Bear/Decision/Synthesizer
  -> recommended opportunities
  -> user notes and build approval
  -> Antigravity managed build
  -> PR and optional preview for the project repo
```

The frontend should show only opportunities that have passed the agent evaluation gate. Raw signals are backend evidence, not the primary product surface.

## Ownership Boundaries

- Frontend owns UI state, forms, project navigation, readable run/build status, opportunity review, and user notes.
- Backend owns Supabase writes, managed-agent calls, GitHub/repo operations, schedules, and Antigravity build invocation.
- Frontend must not receive service-role keys, GitHub tokens, raw API keys, or raw managed-agent prompts.
- User notes are higher priority than agent-generated suggestions when they contradict.

## Status Values

Use these exact string values unless this doc is updated.

```ts
export type ProjectMode = "new_project" | "existing_project";

export type RunStatus = "queued" | "in_progress" | "completed" | "failed";

export type PipelineStage =
  | "project_analysis"
  | "signal_collection"
  | "opportunity_clustering"
  | "bull_bear"
  | "synthesis"
  | "ready"
  | "failed";

export type OpportunityStatus =
  | "recommended"
  | "watched"
  | "rejected"
  | "approved"
  | "building"
  | "built";

export type OpportunityAction =
  | "watch"
  | "reject"
  | "research_more"
  | "approve_for_build";

export type BuildStatus = "in_progress" | "completed" | "failed";
```

## Data Shapes

### Project

Every active Forge project must have or be able to create an associated GitHub repo before a build starts.

```ts
export type Project = {
  id: string;
  name: string;
  mode: ProjectMode;
  repo_url: string | null;
  description: string;
  product_context: string | null;
  schedule: ProjectSchedule | null;
  latest_run: ProjectRun | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSchedule = {
  enabled: boolean;
  cron: string;
  timezone: string;
  next_run_at: string | null;
};
```

Default schedule for new projects:

```json
{
  "enabled": true,
  "cron": "0 8 * * 1-5",
  "timezone": "America/Los_Angeles"
}
```

### Project Run

```ts
export type ProjectRun = {
  id: string;
  project_id: string;
  status: RunStatus;
  stage: PipelineStage;
  trigger: "manual" | "scheduled" | "onboarding";
  started_at: string;
  completed_at: string | null;
  error: string | null;
  summary: string | null;
};
```

### Opportunity Card

This is the list item shape for the project dashboard.

```ts
export type OpportunityCard = {
  id: string;
  project_id: string;
  title: string;
  problem: string;
  target_user: string;
  mvp_concept: string;
  confidence: number;
  status: OpportunityStatus;
  evidence_count: number;
  synthesized_pitch: string | null;
  builder_readiness: "ready" | "not_ready" | null;
  latest_evaluation_run_id: string | null;
  created_at: string;
};
```

### Opportunity Detail

```ts
export type OpportunityDetail = OpportunityCard & {
  evidence_summary: {
    signal_count: number;
    top_sources: string[];
    research_summary: string;
  };
  bull_case: {
    summary: string;
    confidence: number;
    bullets: string[];
  } | null;
  bear_case: {
    summary: string;
    confidence: number;
    risks: string[];
    missing_evidence: string[];
  } | null;
  decision: {
    recommendation: "watch" | "research_more" | "prototype" | "build" | "reject";
    summary: string;
    confidence: number;
    required_constraints: string[];
  } | null;
  synthesis: {
    product_pitch: string;
    mvp_scope: string[];
    non_goals: string[];
    builder_system_prompt: string;
    builder_readiness: "ready" | "not_ready";
  } | null;
  user_notes: string | null;
};
```

### Build

```ts
export type Build = {
  id: string;
  project_id: string;
  opportunity_id: string;
  status: BuildStatus;
  stage: "starting_managed_builder" | "building" | "opening_pr" | "completed" | "failed";
  repo_url: string;
  branch_name: string | null;
  pr_url: string | null;
  preview_url: string | null;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};
```

## API Routes

All routes return JSON. Backend should return `4xx` for invalid user input and `5xx` for backend/agent failures.

### Create Project

```http
POST /api/projects
```

Request:

```json
{
  "mode": "existing_project",
  "name": "My App",
  "description": "Short user-provided product description",
  "repo_url": "https://github.com/user/repo",
  "schedule": {
    "enabled": true,
    "cron": "0 8 * * 1-5",
    "timezone": "America/Los_Angeles"
  }
}
```

For a new project, `name` and `repo_url` may be `null`; backend may create or ask GitHub to create the repo later.

Response:

```json
{
  "project": {
    "id": "uuid",
    "name": "My App",
    "mode": "existing_project",
    "repo_url": "https://github.com/user/repo",
    "description": "Short user-provided product description",
    "product_context": null,
    "schedule": {
      "enabled": true,
      "cron": "0 8 * * 1-5",
      "timezone": "America/Los_Angeles",
      "next_run_at": "2026-05-24T15:00:00Z"
    },
    "latest_run": null,
    "created_at": "ISO",
    "updated_at": "ISO"
  },
  "next_recommended_action": "run_discovery"
}
```

### List Projects

```http
GET /api/projects
```

Response:

```json
{
  "projects": []
}
```

### Get Project

```http
GET /api/projects/:projectId
```

Response:

```json
{
  "project": {}
}
```

### Update Project

```http
PATCH /api/projects/:projectId
```

Request may include `name`, `description`, `repo_url`, `product_context`, or `schedule`.

Response:

```json
{
  "project": {}
}
```

### Brainstorm New Project

Use this when the user does not know what they want to build. Backend should use Gemini managed agents to interview/brainstorm, seed topics, and create a project context.

```http
POST /api/projects/:projectId/brainstorm
```

Request:

```json
{
  "user_prompt": "I like developer tools, AI agents, and fast MVPs.",
  "constraints": ["free services only", "can be built in a weekend"]
}
```

Response:

```json
{
  "run": {
    "id": "uuid",
    "project_id": "uuid",
    "status": "in_progress",
    "stage": "project_analysis",
    "trigger": "onboarding",
    "started_at": "ISO",
    "completed_at": null,
    "error": null,
    "summary": null
  }
}
```

### Import GitHub Project

Use this when the user connects an existing repo. Backend should inspect the repo enough to produce `product_context`, suggested source config, and initial research scope.

```http
POST /api/projects/:projectId/import-github
```

Request:

```json
{
  "repo_url": "https://github.com/user/repo"
}
```

Response:

```json
{
  "run": {
    "id": "uuid",
    "status": "in_progress",
    "stage": "project_analysis"
  }
}
```

### Start Discovery Run

```http
POST /api/projects/:projectId/runs
```

Request:

```json
{
  "run_type": "discovery",
  "trigger": "manual",
  "scope": {
    "repo": true,
    "market_signals": true,
    "github_issues": true,
    "web_research": true
  }
}
```

Response:

```json
{
  "run": {
    "id": "uuid",
    "project_id": "uuid",
    "status": "in_progress",
    "stage": "signal_collection",
    "trigger": "manual",
    "started_at": "ISO",
    "completed_at": null,
    "error": null,
    "summary": null
  }
}
```

### List Project Runs

```http
GET /api/projects/:projectId/runs
```

Response:

```json
{
  "runs": []
}
```

### Get Run

```http
GET /api/runs/:runId
```

Response:

```json
{
  "run": {}
}
```

### List Recommended Opportunities

Only return opportunities with completed Bull/Bear/Decision/Synthesizer evaluation and sufficient confidence.

```http
GET /api/projects/:projectId/opportunities
```

Response:

```json
{
  "opportunities": []
}
```

### Get Opportunity Detail

```http
GET /api/opportunities/:opportunityId
```

Response:

```json
{
  "opportunity": {}
}
```

### Opportunity Action

```http
POST /api/opportunities/:opportunityId/actions
```

Request:

```json
{
  "action": "approve_for_build",
  "user_notes": "Focus on MCP servers only. Do not build a generic schema validator."
}
```

Response:

```json
{
  "opportunity": {
    "id": "uuid",
    "status": "approved",
    "user_notes": "Focus on MCP servers only. Do not build a generic schema validator."
  }
}
```

### Start Build

Builds go to the repo associated with the project. After a build starts, there is no user input in that build. Corrections should create a follow-up build/action.

```http
POST /api/opportunities/:opportunityId/builds
```

Request:

```json
{
  "build_type": "prototype_pr",
  "user_notes": "Make this a CLI plus small web dashboard. Keep it local-only."
}
```

Backend build prompt must include, in priority order:

1. User notes from this request.
2. Saved opportunity user notes.
3. Synthesizer `builder_system_prompt`.
4. Project context and repo URL.
5. Generated PR contract from `AGENTS.md`.

Response:

```json
{
  "build": {
    "id": "uuid",
    "project_id": "uuid",
    "opportunity_id": "uuid",
    "status": "in_progress",
    "stage": "starting_managed_builder",
    "repo_url": "https://github.com/user/repo",
    "branch_name": null,
    "pr_url": null,
    "preview_url": null,
    "summary": null,
    "error": null,
    "started_at": "ISO",
    "completed_at": null
  }
}
```

### Get Build

```http
GET /api/builds/:buildId
```

Response:

```json
{
  "build": {}
}
```

## Realtime Contract

Simplest implementation: frontend subscribes to Supabase Realtime for status tables and refetches API details when an event arrives.

Frontend cares about these events:

```ts
export type RealtimeEvent =
  | {
      type: "run_updated";
      project_id: string;
      run_id: string;
      status: RunStatus;
      stage: PipelineStage;
    }
  | {
      type: "opportunity_ready";
      project_id: string;
      opportunity_id: string;
    }
  | {
      type: "build_updated";
      project_id: string;
      build_id: string;
      status: BuildStatus;
      pr_url?: string;
      preview_url?: string;
    };
```

Do not stream raw logs in v1. Show readable status:

```text
Analyzing repo
Collecting market signals
Clustering opportunities
Running Bull/Bear review
Writing product pitch
Building prototype
Opening PR
Completed
Failed
```

## Supabase Mapping

Existing tables:

```text
pipeline_runs
signals
opportunities
opportunity_signals
opportunity_evaluations
```

Needed for the full dashboard contract:

```text
projects
project_source_configs
project_runs
project_schedules
opportunity_actions
mvp_builds
```

Optional later table:

```text
opportunity_clusters
```

For now, cluster packets may remain in `pipeline_runs.metadata` with `metadata.pipeline = "opportunity_clustering"`.

## Backend Pipeline Requirements

For a discovery run, backend must perform these steps:

1. Create or update `project_runs` as `in_progress`.
2. Analyze project repo/context when present.
3. Collect public/repo/social signals.
4. Save `signals`.
5. Create rough `opportunities`.
6. Link evidence with `opportunity_signals`.
7. Cluster duplicate/related opportunities.
8. Run BullAgent, BearAgent, DecisionAgent, and Synthesizer on canonical clusters.
9. Save evaluator outputs to `opportunity_evaluations`.
10. Mark only confident opportunities as `recommended`.
11. Mark run `completed` or `failed`.

## Frontend Requirements

The first useful dashboard should include:

- Sidebar project list and create/import project action.
- Project command center as the main page.
- Repo URL, schedule, latest run status, and Run Now button.
- Recommended opportunity cards.
- Opportunity detail drawer or page with pitch, evidence summary, Bull/Bear rationale, decision, user notes, and Build Prototype button.
- Build status section with PR and preview links when available.

Avoid exposing raw signals as the main view. Evidence can appear as a collapsible research section under opportunity detail.

## Verification Checklist

Frontend can verify against mocked API responses before backend routes exist:

- Create project form can submit the `POST /api/projects` request shape.
- Project page can render a `Project` with no latest run.
- Project page can render `latest_run.status = "in_progress"` and `stage = "bull_bear"`.
- Opportunity list only uses `OpportunityCard`.
- Opportunity detail renders missing Bull/Bear/Synthesis sections without crashing.
- User notes are sent with `approve_for_build` and with `POST /builds`.
- Build status renders `in_progress`, `completed`, and `failed`.

Backend can verify:

- Every route returns the documented envelope key: `project`, `projects`, `run`, `runs`, `opportunity`, `opportunities`, or `build`.
- Run statuses use only `queued`, `in_progress`, `completed`, `failed`.
- Pipeline stages use only the listed `PipelineStage` values.
- Recommended opportunities have Synthesizer output and Decision confidence.
- `POST /builds` refuses to start without a project repo URL.
- Managed build prompts include user notes before Synthesizer output.
- No frontend response includes service-role keys, GitHub tokens, API keys, or raw managed-agent prompts.

## Current Backend Reality

Implemented now:

- Managed research ingestion CLI.
- Public source collection.
- Opportunity clustering.
- Bull/Bear/Decision/Synthesizer managed-agent evaluation.
- Fast fallback research/evaluation path that still returns Bull/Bear/Synthesizer-shaped artifacts when managed agents are slow or quota-limited.
- Supabase writes to existing ingestion/evaluation tables.
- Dashboard API routes under `forge_managed_research.api`.
- Project, schedule, run, action, and build migration in `supabase/migrations/0002_dashboard_contract.sql`.

Not implemented yet:

- Applied remote dashboard migration, unless a developer has run `0002_dashboard_contract.sql` in Supabase.
- Schedule runner.
- Antigravity builder adapter for project repo PRs. The API currently stores the build prompt context and marks the build record complete.
- Realtime dashboard subscriptions.

Build the frontend against this contract while backend fills those missing pieces.
