# Goal

Forge should help a human create and iterate on products in a product-first way.

The practical v1 goal is a reproducible vertical slice that turns product context, configured inputs, user preferences, and a small auditable signal set into a product recommendation, reviewed prototype direction, and optionally a PR-ready MVP built by a managed sandbox agent.

## First Useful Outcome

A local, scheduled, or manually triggered Forge run can:

1. Load a project in either connected-product mode or new-product/sample mode.
2. Load an explicit user preference profile and product context.
3. Ingest manual ideas, configured feedback sources, public source signals, or web/social research results.
4. Rank product opportunities against evidence, product context, taste, feasibility, novelty, and behavior history.
5. Run taste critique and parallel Bull/Bear review for the strongest candidates.
6. Ask a Decision Agent to recommend watch, research more, prototype, build, or reject.
7. Show the human a product briefing with evidence, critique, decision rationale, and prototype options.
8. Generate an internal build brief from an approved direction.
9. Start a managed builder run against generated UI, a generated repo, or a template-based MVP repo.
10. Record generated artifacts, PR URL when applicable, README summary, checks, run instructions, and follow-up feedback.
11. Reflect on human choices, ignored suggestions, failures, and build outcomes to improve Forge's memory, rubrics, skills, and trigger policies for future runs.

## Users

- Founders who want better product judgment and working prototypes for promising ideas.
- Startup studios evaluating and iterating on multiple product directions quickly.
- Developer tool investors or operators tracking emerging pain.
- Builders who want an agentic product partner that can research, critique, prototype, and learn from feedback.

## Success Criteria

- Preference profiles and preference events can be stored and used for opportunity ranking.
- Project context, source configs, triggers, and opportunity evidence can be stored and audited.
- Opportunities can be traced back to source records, research outputs, product context, or manual inputs.
- A human approves only the opportunity before a build starts.
- The system can render a morning/product review with at least one decision recommendation.
- Bull/Bear and Decision Agent output is stored as structured opportunity evaluation data.
- Build state is persisted from approval through generated PR review.
- Generated PRs include runnable code, README instructions, and tests or smoke checks.
- Reflection runs can propose safe memory/rubric/skill/trigger updates based on human feedback or failures.
- Cloud or managed-sandbox integration is attempted only after local contracts and simulated build flows work.

## Non-Goals

- Full user billing, teams, or workspace management.
- Perfect source coverage across the entire internet.
- Production deployments from generated MVPs.
- Paid API usage by the managed builder.
- Fully autonomous core system rewrites without audit or approval.
- Fine-tuned models.
- Claims that generated MVPs prove validated market demand.
