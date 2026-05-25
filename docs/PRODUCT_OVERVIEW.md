# Product Overview

Forge is an agentic product partner for people building software products. Its job is to keep product context, evidence, taste, critique, and build follow-through in one loop.

Forge should not feel like an agent control room. The user should mostly see product decisions: what Forge knows, what changed, which opportunities are worth attention, why the recommendation fits, and what happens if they approve a build.

## Current Product

The current product is a local-first dashboard and orchestration layer for connected-product review.

The strongest working loop is:

1. The user creates a project and optionally connects a GitHub repo.
2. Forge stores project context, GitHub source config, manual source config, trigger config, and preference notes.
3. The user runs Dream.
4. Forge runs reflection over prior local records.
5. If a repo is connected, Forge collects repo metadata, README text, issue evidence, and a bounded file tree scan.
6. Forge sends that context to a repo-analysis agent through the Gemini Interactions API.
7. The agent returns strict JSON with project knowledge and repo-grounded opportunities.
8. Forge validates and normalizes the output into signals, opportunities, evaluations, prototype options, and pipeline metadata.
9. The dashboard shows recommendations and evidence.
10. The user can pass, watch, request more research, refine the opportunity, or approve a build.
11. Build approval creates an auditable build brief and starts the simulated or managed builder.
12. Build artifacts and reflection proposals are stored for later review.

This is enough to demonstrate the product loop for connected repos. It is not enough to claim broad market monitoring, autonomous product discovery, or reliable generated-MVP delivery.

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
- Broad public trend coverage.
- Whether a generated MVP proves demand.

These should be added through explicit source records, evaluations, and user-visible uncertainty, not hidden model claims.

## Readiness Assessment

Current readiness:

- Connected repo product review: early but working with credentials.
- Local dashboard demo: working.
- Local simulated build path: working.
- Managed builder path: implemented but dependent on live credentials and external API behavior.
- New-product discovery: context capture only; needs agent-backed recommendations.
- Scheduled autonomous runs: contract and control surface exist, but not a production scheduler.
- Reflection: simple auditable proposal engine, not full self-improvement automation.

## Near-Term Product Priorities

1. Keep docs in sync with implementation after every product or contract change.
2. Add agent-backed new-product discovery so Forge works without an existing repo.
3. Add tests for pipeline, build, reflection, and empty-state behavior.
4. Make live credential requirements and failure states obvious in the UI.
5. Wire dashboard runs to the managed research service or consolidate the two paths.
6. Add one reliable public source before broad scraping.

## Product Boundaries

Forge recommendations are decision support, not validation.

Generated MVPs are evidence that a direction is buildable, not evidence that users want it.

Reflection improves Forge's operating behavior; it must not silently weaken safety rules, build permissions, credential handling, or source quality requirements.
