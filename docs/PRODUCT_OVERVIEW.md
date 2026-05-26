# Product Overview

Forge is an agentic product partner for people building software products. Its job is to keep product context, evidence, taste, critique, and build follow-through in one loop.

Forge should not feel like an agent control room. The user should mostly see product decisions: what Forge knows, what changed, which opportunities are worth attention, why the recommendation fits, and what happens if they approve a build.

## Current Product

The current product is a local-first dashboard and orchestration layer for connected-product review plus AI-led intake for new-product research.

The strongest working loop is:

1. The user creates a project and optionally connects a GitHub repo or seeds a new product with one freeform idea message.
2. Forge stores project context, GitHub source config, manual source config, trigger config, and preference notes.
3. For a new product, Forge starts from that freeform message or lets the user talk through a direction with an AI-led intake surface.
4. The intake agent compiles the conversation into a structured research brief when enough context exists, or returns model-generated open questions that drive the next user turn. If the compiler is unavailable, Forge still stores a non-approvable draft with product follow-up questions derived from the user's conversation instead of shifting the conversation into setup troubleshooting.
5. The project header routes new-product work back into the conversation, follow-up, brief review, or research state instead of offering a generic Dream run.
6. The user approves the brief to queue research-agent tasks.
7. The user runs Dream for connected-product review.
8. Forge runs reflection over prior local records.
9. If a repo is connected, Forge collects repo metadata, README text, issue evidence, and a bounded file tree scan.
10. Forge sends that context to a repo-analysis agent through the Gemini Interactions API.
11. The agent returns strict JSON with project knowledge and repo-grounded opportunities.
12. Forge validates and normalizes the output into signals, opportunities, evaluations, prototype options, agent tasks, research briefs, and pipeline metadata.
13. The dashboard shows recommendations, evidence, and whether managed research has enough cited evidence to treat candidates as build-ready. Thin managed-research candidates stay as run metadata until they clear the evidence gate.
14. The user can pass, watch, request more research, refine the opportunity, or approve a build.
15. Build approval creates an auditable build brief and starts the simulated or managed builder.
16. Build artifacts and reflection proposals are stored for later review.

This is enough to demonstrate the product loop for connected repos and the intake-to-brief-to-research-review shape for new products when the managed research backend is configured. It is not enough to claim broad market monitoring, autonomous product discovery, or reliable generated-MVP delivery.

## Product Promise

Forge should eventually answer:

- What should I build next for this product?
- What evidence supports that?
- What is the strongest case against it?
- Is this aligned with my taste and constraints?
- Should I watch, research, prototype, build, or reject it?
- If I approve it, can an agent produce a runnable prototype or PR-ready MVP?
- What did Forge learn from my decision and the build outcome?

## Current User Experience

The dashboard has these surfaces:

- Projects overview.
- New project onboarding.
- Project review page.
- Opportunity detail page.
- Project settings page.
- Scheduler controls.
- Reflection proposal review.
- Build status and artifact display.

The UI intentionally presents recommendations as product review artifacts rather than raw agent logs.

## What Forge Knows Today

Forge persists:

- Projects and project context.
- User/workspace ownership for projects and runtime records.
- GitHub App connection metadata linked to project GitHub sources, with server-side repo listing and App installation-token exchange for repo discovery. GitHub user OAuth is kept as an optional generated-repo connector, not the connected-product repo path. Connected-product setup is not considered complete until the GitHub source has a scoped App connection id, even if public repo discovery can run from a raw repo URL. In hosted auth-required mode, repo-only connected projects keep the GitHub source paused and route the primary review action to GitHub setup until that scoped connection exists.
- Idea conversations, messages, research briefs, and agent task queues.
- Source configs and trigger configs.
- User preference profiles.
- Preference events from approvals, rejections, ignored/watched items, feedback, and build requests.
- Pipeline runs and metadata.
- Signals from manual context, repo evidence, and managed research paths.
- Opportunities and linked evidence.
- Opportunity evaluations.
- Prototype options.
- MVP build records.
- Build artifacts.
- Reflection runs and proposals.

## What Forge Does Not Know Yet

Forge does not yet have a robust model of:

- Cross-project user taste.
- Long-term source reliability.
- Market size or buyer urgency.
- Real prototype usage.
- Production analytics.
- Competitor change monitoring.
- Broad public trend coverage beyond the current HN, Reddit, Stack Exchange, and GitHub issue collectors.
- Whether a generated MVP proves demand.

These should be added through explicit source records, evaluations, and user-visible uncertainty, not hidden model claims.

## Readiness Assessment

Current readiness:

- Connected repo product review: early but working with credentials.
- Local dashboard demo: working.
- Local simulated build path: working.
- Managed builder path: implemented but dependent on live credentials and external API behavior.
- New-product discovery: AI-led intake, fresh conversation start after completed research, project-header routing into the conversation state, scheduled-run gating until brief approval, brief approval, queued research worker handoff, manual run-now from the project page, phase-labeled agent progress, latest-run evidence sufficiency status, daily hosted worker cron config, managed source collection, Taste/Bull/Bear/Decision/Synthesizer-shaped evaluation, evidence-ready promotion, Synthesizer build-direction handoff, and evidence-quality build gates exist; generic new-product runs now wait for an approved brief instead of replacing source-backed results with local context. Live managed eval and broader scheduler hardening are still pending.
- Runtime readiness: project settings show which live paths are configured or missing and can run server-side health checks without exposing secret values.
- User-scoped identity: hosted requests can validate Supabase Auth bearer headers, Forge's built-in httpOnly session cookie, or `sb-*-auth-token` cookies, map the auth subject to Forge user/workspace scope, and provision the user's default workspace on first write. Minimal `/signup` and `/login` pages create Forge email accounts through Supabase magic links and set Forge access/refresh cookies after server-side token validation. The `/account` page shows that email is the Forge account boundary and GitHub is only a connector after the email account exists. Optional email/domain allowlists gate private beta access both before magic-link delivery and after token validation. Request-session validation can refresh expired access cookies, and hosted deployments can set `FORGE_REQUIRE_AUTH=1` to block fallback local identity. Env-scoped identity remains available for local dev and server jobs.
- Realtime status updates: hosted signed-in project pages can subscribe to Supabase Realtime for project-scoped run, research, opportunity, prototype, build, and reflection status changes, while preserving local polling fallback.
- GitHub connection: hosted connected-repo discovery and existing-repo PRs use the project-linked GitHub App installation. GitHub user OAuth is only for user-account generated repo creation, so connected-product repo access can stay selected-repo/App scoped instead of broad user-token scoped. A raw public repo URL remains useful for local-dev public discovery, but hosted connected-product creation and research wait until the repo source has an active scoped App connection instead of relying on broad server tokens. Pre-created generated-repo targets and organization generated-repo creation use GitHub App installation tokens. New-product GitHub App installs or authorized user connections are recorded as generated-repo targets automatically. Signed GitHub webhook handling has route-level contract proof for rejecting invalid signatures and mutating installation status only after verification, and runtime health can prove public route reachability with a signed non-mutating `ping` when `FORGE_PUBLIC_APP_URL` is configured. `FORGE_GITHUB_TOKEN`/`GITHUB_TOKEN` is a local-dev fallback only when `FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1`, is ignored when `FORGE_REQUIRE_AUTH=1`, and does not make the hosted managed-builder path ready.
- Scheduled autonomous runs: daily hosted worker cron exists for queued approved-brief research; project trigger policies still need production-grade scheduling semantics.
- Reflection: simple auditable proposal engine, not full self-improvement automation.

## Near-Term Product Priorities

1. Keep docs in sync with implementation after every product or contract change.
2. Harden approved-brief research with live managed evaluation, richer task progress, and stricter end-to-end evidence sufficiency proof.
3. Prove GitHub App install, OAuth callback, and real delivery webhooks against a live app; route-level webhook proof and signed runtime `ping` proof exist, but live GitHub delivery still needs hosted credentials.
4. Add tests for pipeline, build, reflection, brief approval, and empty-state behavior.
5. Keep expanding the readiness panel from basic health checks into full end-to-end proof as hosted credentials come online.
6. Add one reliable public source before broad scraping.

## Product Boundaries

Forge recommendations are decision support, not validation.

Generated MVPs are evidence that a direction is buildable, not evidence that users want it.

Reflection improves Forge's operating behavior; it must not silently weaken safety rules, build permissions, credential handling, or source quality requirements.
