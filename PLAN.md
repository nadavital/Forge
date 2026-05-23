# Plan

## Objective

Build the smallest end-to-end system that can be inspected and rerun:

1. Project context in connected-product or new-product/sample mode.
2. Configurable source and trigger contracts.
3. Preference profile and preference events.
4. Opportunity ranking.
5. Taste, Bull/Bear, and Decision evaluation.
6. Human product review and approval.
7. Prototype/build brief generation.
8. Simulated managed builder output.
9. Generated artifact and PR contract.
10. Reflection/dreaming loop contract for improving Forge behavior.

Do not start with live Antigravity or Vertex deployment. Start with local fixtures, schemas, and a simulated builder adapter.

## Phase 1: Contracts

- Define SQL migrations for the tables in [Data Model](./docs/DATA_MODEL.md).
- Define schemas for projects, source configs, triggers, preference profiles, preference events, opportunities, evaluations, decisions, prototype options, build briefs, build states, build artifacts, and reflection runs.
- Add fixtures for one connected product, one new-product/sample project, one user profile, several signals or manual ideas, three ranked opportunities, one product review, one approved opportunity, one simulated MVP build, and one reflection proposal.

Exit criteria:

- Schema can be applied to a database.
- Fixture data can be loaded without model calls.
- Opportunity ranking output can be validated.
- Evaluation and decision output can be validated.
- Build brief and build artifact output can be validated.
- Reflection proposals can be validated without mutating live agent behavior.

## Phase 2: Product Context And Source Pipeline

- Implement project creation for connected-product and new-product/sample modes.
- Implement source config and trigger config fixtures before live scheduling.
- Implement manual opportunity input first.
- Implement the managed trend-to-research goal in [Managed Trend Research Goal](./docs/MANAGED_TREND_RESEARCH_GOAL.md): TrendScout retrieves public media/social/repo content, ResearchAnalyst researches the strongest retrieved trends, and Forge persists validated outputs.
- Add one public signal source only after manual fixtures work.
- Normalize records into `signals`.
- Combine `user_preferences` and `preference_events` into a scoring context.
- Rank opportunities by fit, evidence, feasibility, and novelty.
- Persist opportunity evaluations, including taste critique, Bull/Bear output, and Decision Agent recommendation.

Good first source options:

- Manual ideas entered in the dashboard or fixture JSON.
- Hacker News official/API-accessible items.
- GitHub issues or discussions from a configured repo.
- Reddit only if auth and rate-limit behavior are handled explicitly.
- Deep/web research only after source/result contracts are stable.

Exit criteria:

- One command ranks fixture opportunities for a sample profile.
- One command runs the managed trend-to-research pipeline and prints a `pipeline_run_id`, retrieved media count, research finding count, signal count, and opportunity count.
- The saved run is inspectable in Supabase and shows retrieved media content plus corresponding research-derived signals.
- Approvals and rejections create `preference_events`.
- Ranking changes when preference events change.
- A product review can be generated from stored opportunities and evaluations.

## Phase 3: Review, Approval, And Managed Build Simulation

- Treat human approval of an opportunity as the only required approval gate.
- Generate inline prototype option records before or alongside build briefs.
- Generate a concise internal build brief from the approved direction.
- Create an `mvp_builds` row with template repo, generated repo target, branch, and status.
- Implement a simulated builder adapter that writes expected build results without calling Antigravity.
- Run a `BuildReviewer` check over simulated artifacts.

Exit criteria:

- Approved opportunity creates one build record.
- Approved opportunity can create one or more prototype options.
- Build status transitions are valid and auditable.
- Simulated builder output includes generated repo URL, PR URL, README summary, tests or smoke checks, and run instructions.

## Phase 4: Dashboard And Morning Review

- Scaffold the internal dashboard.
- Render project context, source configs, trigger configs, preference profile, ranked opportunities, evaluation summaries, approval actions, and build status.
- Render a morning/product review surface with what changed, strongest opportunities, evidence, critique, decision recommendation, and available prototype options.
- Render build artifacts after simulated builder completion.
- Add realtime only after historical rendering works.

Exit criteria:

- Dashboard renders existing records on refresh.
- Approving an opportunity starts or queues an MVP build.
- User feedback on recommendations, prototypes, approvals, rejections, and ignored items creates preference or reflection events.
- Service-role credentials are not exposed to the browser.

## Phase 5: Reflection / Dreaming Loop

- Implement a reflection run over stored feedback, ignored suggestions, failed builds, build review failures, and user edits.
- Generate proposed memory, rubric, skill, scoring, and trigger-policy changes.
- Store proposed changes without applying high-risk changes automatically.
- Add local fixture eval cases so proposed behavior changes can be regression-tested against prior examples.

Exit criteria:

- One command produces a reflection proposal from fixtures.
- Reflection proposal references concrete prior events or failures.
- Low-risk memory/preference changes are distinguishable from review-required prompt/skill/policy changes.
- No reflection run silently mutates production credentials, destructive permissions, or build policies.

## Phase 6: Managed Sandbox Runtime

- Verify current Antigravity, Google ADK, and Vertex AI Agent Engine integration requirements.
- Replace the simulated builder adapter with a managed builder adapter.
- Create generated repos from the template repo.
- Open PRs using the title format `Build MVP: <opportunity title>`.
- Add a runbook based on commands that have actually been executed.

Exit criteria:

- Managed builder can create a generated repo PR from a stored build brief.
- Forge records builder logs, generated repo URL, branch, PR URL, artifacts, and failure state.
- BuildReviewer blocks completion if README, run instructions, tests or smoke checks, or free-service documentation are missing.

## Defer

- Multi-source scraping.
- Fully automatic builds without human opportunity approval.
- Fully automatic high-risk reflection patches.
- Paid APIs or production deploys.
- User accounts and billing.
- Sophisticated preference learning beyond explicit profile plus approval/rejection events.
- Claims of validated market demand.
