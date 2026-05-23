# Plan

## Objective

Build the smallest end-to-end system that can be inspected and rerun.

Do not start with Vertex deployment. Start with local fixtures, schemas, and one reliable ingestion path.

## Phase 1: Contracts

- Define SQL migrations for the core tables in [Data Model](./docs/DATA_MODEL.md).
- Define Python or TypeScript schemas for agent outputs.
- Add fixture source records.
- Add fixture expected thesis JSON shape.

Exit criteria:

- Schema can be applied to a database.
- Fixture data can be loaded without model calls.
- Generated output shape can be validated.

## Phase 2: Local Pipeline

- Implement one ingestion source first.
- Normalize records into `signals`.
- Create a deterministic candidate selection function.
- Run a bounded Bull/Bear/Synthesizer loop.
- Persist a thesis and debate messages.

Good first source options:

- Hacker News official/API-accessible items.
- Reddit only if auth/rate-limit behavior is handled explicitly.
- Search only after the core pipeline works.

Exit criteria:

- One command runs the local pipeline against fixtures.
- One command runs it against a real source with documented limits.
- Failures are logged or persisted instead of silently ignored.

## Phase 3: Dashboard

- Scaffold the Next.js app.
- Render theses and debate messages from the database.
- Add Supabase Realtime only after historical rendering works.
- Add Q&A only after thesis display is stable.

Exit criteria:

- The dashboard renders existing records on refresh.
- New debate messages appear through realtime subscription.
- Service-role credentials are not exposed to the browser.

## Phase 4: Cloud Runtime

- Verify current Google ADK and Vertex AI Agent Engine deployment requirements.
- Wrap the already-working local agent pipeline.
- Deploy only after local schema validation and source handling work.
- Add a runbook based on commands that have actually been executed.

Exit criteria:

- Remote invocation can create a pipeline run.
- Supabase receives messages and thesis records from the remote run.
- Dashboard receives the remote run through normal database reads/subscriptions.

## Defer

- Multi-source scraping.
- Daily scheduling.
- Polished animation.
- User accounts.
- Billing.
- Fine-tuning.
- Claims of validated market demand.
