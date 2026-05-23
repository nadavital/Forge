# Agent Prompt Contracts

These are behavioral contracts, not production prompts. Production prompts should live near the code that validates their outputs.

General rules for every role:

- Use supplied source material and explicit preference data unless marking an inference.
- Preserve source IDs for claims.
- Prefer `unknown` over invented market facts.
- Return structured data that can be validated.
- Keep outputs concise enough for downstream agents to inspect.
- Do not select paid APIs, production deploys, or secret-requiring integrations for v1 generated MVPs.

## SignalCollector

Normalize manual ideas and public source records into product opportunity signals. Preserve provenance, source URL, source ID, author, timestamp, and raw text when allowed.

Return structured output with:

- source
- source ID
- title
- body
- URL
- timestamp
- tags
- provenance metadata

## PreferenceModeler

Combine explicit preference profile fields with behavior events. Make a compact scoring context for opportunity ranking.

Return structured output with:

- preferred markets
- preferred buyers
- excluded categories
- risk tolerance
- stack preferences
- inferred preference adjustments
- negative signals from rejections
- positive signals from approvals and launches

## OpportunityScout

Propose and rank product opportunities that could become small runnable MVPs. Use the preference context and signal evidence. Prefer ideas that can be prototyped quickly and convincingly.

Return structured output with:

- title
- problem
- target user
- MVP concept
- source IDs
- fit score
- feasibility score
- novelty score
- evidence score
- score rationale

## Critic

Challenge the opportunity before it reaches approval. Focus on weak evidence, buyer ambiguity, implementation risk, scope creep, and mismatch with user preferences.

Return structured output with:

- blocking concerns
- non-blocking concerns
- suggested scope reductions
- evidence gaps
- score adjustments

## BuildBriefGenerator

Create an internal build brief only after a human approves an opportunity. The brief should be enough for a managed builder to produce a PR-ready MVP without further planning approval.

Return structured output with:

- approved opportunity ID
- product summary
- target user
- MVP scope
- non-goals
- suggested implementation approach
- allowed services
- prohibited services
- acceptance checks
- generated PR title

## ManagedBuilder

Run in an Antigravity sandbox. Create a generated repository from the template repo, build the MVP, and open a PR.

Required behavior:

- Stay within the approved opportunity and build brief.
- Use whatever stack fits the product.
- Use code and free services only.
- Do not use paid APIs, production deployments, or secret-requiring integrations.
- Document any free external services used.
- Open PR title as `Build MVP: <opportunity title>`.

## BuildReviewer

Review generated MVP output before Forge marks the build complete.

Required checks:

- README exists.
- Setup and run instructions exist.
- Basic tests or smoke checks exist.
- Product MVP is explained.
- Free external services are listed if used.
- No service-role keys, paid API keys, or production credentials are committed.
