# Open Questions

Answer these before expanding scope. Do not block the first fixture-based vertical slice on every item here.

## Product

- What fields are required in the first explicit preference profile?
- Should manual ideas be entered before public source ingestion exists?
- What makes an opportunity good enough to show for approval?
- How should Forge display why a recommendation matches the user's taste?

## Dreaming Loop

- How much should approvals and rejections change future rankings?
- Should launched MVPs carry more preference weight than approvals?
- Should generated build failures reduce future ranking for similar ideas?
- How should users reset or edit learned preferences?

## Builder

- What template repo should generated MVPs start from?
- How are generated repos named?
- Who owns generated repos: the Forge org, the user, or a generated-project org?
- What exact Antigravity API or workflow starts a sandbox build?
- What logs and artifacts can Antigravity return?

## Safety

- What counts as a free service in v1?
- Should services requiring user-created accounts be allowed if no paid plan is needed?
- How should Forge detect committed secrets in generated PRs?
- What policy blocks production deployment attempts?

## Infrastructure

- Which Google Cloud project and region are authorized for Vertex AI Agent Engine?
- Should the first real build be manually triggered before any schedule exists?
- Should build orchestration live in a Python service, Supabase Edge Functions, or Next.js API routes?
- What authentication model protects profile edits, approvals, and build triggers?

## Frontend

- Should the first dashboard optimize for opportunity review or build monitoring?
- Should realtime update by whole build status first, leaving streaming logs for later?
- Should generated MVP artifacts render inline or link to the generated repo PR?
