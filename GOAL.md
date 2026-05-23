# Goal

Forge should help a human find product opportunities that match their preferences and turn approved opportunities into runnable MVPs.

The practical v1 goal is a reproducible vertical slice that turns a small, auditable set of source items and user preferences into a PR-ready MVP built by a managed sandbox agent.

## First Useful Outcome

A local or cloud-triggered Forge run can:

1. Load an explicit user preference profile.
2. Ingest manual ideas or public source signals.
3. Rank product opportunities against the profile and behavior history.
4. Ask the human to approve one opportunity.
5. Generate an internal build brief from the approved opportunity.
6. Start a managed builder run against a generated repo created from a template.
7. Record the generated PR URL, README summary, checks, and run instructions.

## Users

- Founders who want working MVPs for promising ideas.
- Startup studios evaluating multiple product directions quickly.
- Developer tool investors or operators tracking emerging pain.
- Builders who want an agent to convert opportunity taste into shipped prototypes.

## Success Criteria

- Preference profiles and preference events can be stored and used for opportunity ranking.
- Opportunities can be traced back to source records or manual inputs.
- A human approves only the opportunity before a build starts.
- Build state is persisted from approval through generated PR review.
- Generated PRs include runnable code, README instructions, and tests or smoke checks.
- Cloud or managed-sandbox integration is attempted only after local contracts and simulated build flows work.

## Non-Goals

- Full user billing, teams, or workspace management.
- Perfect source coverage across the entire internet.
- Production deployments from generated MVPs.
- Paid API usage by the managed builder.
- Fine-tuned models.
- Claims that generated MVPs prove validated market demand.
