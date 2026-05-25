# Open Questions

Answer these before expanding scope. Do not block the first fixture-based vertical slice on every item here.

## Current Answers

- Minimum useful connected-product setup: a project with a GitHub repo URL, preference notes, manual/GitHub source configs, and a manual trigger. This path can run repo discovery and semantic repo analysis.
- Minimum useful new-product setup: project context and preference notes only. It is not useful enough yet because it does not produce agent-backed recommendations.
- First dashboard priority: product review and approval, not raw source browsing.
- First build approval rule: human approves the opportunity/direction only; Forge owns implementation details inside the v1 build contract.
- First reflection boundary: reflection may store proposals, but it must not silently change high-risk prompts, skills, credentials, destructive permissions, or build policies.
- Current docs rule: any product, architecture, agent, data, or runtime change must update the matching docs in the same change.

## Product

- What is the minimum useful connected-product setup?
- What is the minimum useful new-product/sample setup?
- What fields are required in the first explicit preference profile?
- What fields are required in the first project context profile?
- Which source configs should v1 support: manual feedback, GitHub, HN, web search, social search, competitor URLs?
- Which trigger types should v1 support: manual, daily schedule, source-volume spike, sentiment shift, competitor change, release follow-up?
- Should manual ideas be entered before public source ingestion exists?
- What makes an opportunity good enough to show for approval?
- How should Forge display why a recommendation matches the user's taste?
- What does a morning/product review need to contain for a user to make a real decision?
- Which actions should be available from a review: watch, research more, prototype, build, reject?

## Dreaming Loop

- What is safe for Forge to auto-apply after reflection?
- How much should approvals, rejections, ignored suggestions, and prototype interactions change future rankings?
- Should launched prototypes or MVPs carry more preference weight than approvals?
- Should generated build failures reduce future ranking for similar ideas, or only change builder/rubric behavior?
- How should Forge propose patches to memory, prompts, skills, scoring rubrics, and trigger policies?
- What eval cases should be created when a reflection proposal addresses a failure?
- How should users reset, edit, or reject learned preferences and reflection changes?
- How should the UI distinguish product research from Forge self-improvement reflection?

## Research And Sources

- Should Deep Research run during new-product setup, scheduled scans, or only when a Decision Agent recommends research more?
- What source terms and rate limits apply to each connector?
- How should web/social search results be deduplicated and attributed?
- Which signals count as observed evidence versus inference?
- How should Forge detect sentiment and trend shifts without overreacting to noisy sources?

## Builder

- What template repo should generated MVPs start from?
- How are generated repos named?
- Who owns generated repos: the Forge org, the user, or a generated-project org?
- What exact Antigravity API or workflow starts a sandbox build?
- What logs and artifacts can Antigravity return?
- Which prototype types should exist before full generated repo builds: generated UI, static mock, clickable demo, branch, generated repo?
- Should auto-prototype be disabled, light UI only, code branch, or aggressive?

## Safety

- What counts as a free service in v1?
- Should services requiring user-created accounts be allowed if no paid plan is needed?
- How should Forge detect committed secrets in generated PRs?
- What policy blocks production deployment attempts?
- Which reflection changes are too risky to apply automatically?
- How should Forge prevent reflection from weakening safety policies?

## Infrastructure

- Which Google Cloud project and region are authorized for Vertex AI Agent Engine?
- Should the first real build be manually triggered before any schedule exists?
- Should build orchestration live in a Python service, Supabase Edge Functions, or Next.js API routes?
- Where should trigger scheduling live?
- What authentication model protects profile edits, approvals, and build triggers?

## Frontend

- Should the first dashboard optimize for morning/product review, source configuration, or build monitoring?
- Should realtime update by whole build status first, leaving streaming logs for later?
- Should generated UI and prototype artifacts render inline, link to generated repo PRs, or both?
- How should Bull/Bear and Decision Agent output be displayed without making the UI feel crowded?
- How should reflection proposals be reviewed and approved?
