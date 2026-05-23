# Plan

## Objective

Build the smallest end-to-end system that can be inspected and rerun:

1. Preference profile.
2. Opportunity ranking.
3. Human opportunity approval.
4. Build brief generation.
5. Simulated managed builder output.
6. Generated repo PR contract.

Do not start with live Antigravity or Vertex deployment. Start with local fixtures, schemas, and a simulated builder adapter.

## Phase 1: Contracts

- Define SQL migrations for the tables in [Data Model](./docs/DATA_MODEL.md).
- Define schemas for preference profiles, preference events, opportunities, build briefs, build states, and build artifacts.
- Add fixtures for one user profile, several signals or manual ideas, three ranked opportunities, one approved opportunity, and one simulated MVP build.

Exit criteria:

- Schema can be applied to a database.
- Fixture data can be loaded without model calls.
- Opportunity ranking output can be validated.
- Build brief and build artifact output can be validated.

## Phase 2: Preference-Aware Opportunity Pipeline

- Implement manual opportunity input first.
- Add one public signal source only after manual fixtures work.
- Normalize records into `signals`.
- Combine `user_preferences` and `preference_events` into a scoring context.
- Rank opportunities by fit, evidence, feasibility, and novelty.
- Persist opportunity evaluations, including critique output.

Good first source options:

- Manual ideas entered in the dashboard or fixture JSON.
- Hacker News official/API-accessible items.
- Reddit only if auth and rate-limit behavior are handled explicitly.

Exit criteria:

- One command ranks fixture opportunities for a sample profile.
- Approvals and rejections create `preference_events`.
- Ranking changes when preference events change.

## Phase 3: Approval And Managed Build Simulation

- Treat human approval of an opportunity as the only required approval gate.
- Generate a concise internal build brief from the approved opportunity.
- Create an `mvp_builds` row with template repo, generated repo target, branch, and status.
- Implement a simulated builder adapter that writes expected build results without calling Antigravity.
- Run a `BuildReviewer` check over simulated artifacts.

Exit criteria:

- Approved opportunity creates one build record.
- Build status transitions are valid and auditable.
- Simulated builder output includes generated repo URL, PR URL, README summary, tests or smoke checks, and run instructions.

## Phase 4: Dashboard

- Scaffold the internal dashboard.
- Render preference profile, ranked opportunities, approval actions, and build status.
- Render build artifacts after simulated builder completion.
- Add realtime only after historical rendering works.

Exit criteria:

- Dashboard renders existing records on refresh.
- Approving an opportunity starts or queues an MVP build.
- Service-role credentials are not exposed to the browser.

## Phase 5: Managed Sandbox Runtime

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
- Paid APIs or production deploys.
- User accounts and billing.
- Sophisticated preference learning beyond explicit profile plus approval/rejection events.
- Claims of validated market demand.
