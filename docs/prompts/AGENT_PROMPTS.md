# Agent Prompt Contracts

These are behavioral contracts, not production prompts. Production prompts should live near the code that validates their outputs.

General rules for every role:

- Use only supplied source material unless explicitly marking an inference.
- Preserve source IDs for claims.
- Prefer `unknown` over invented market facts.
- Return structured data that can be validated.
- Keep outputs concise enough for downstream agents to inspect.

## TrendScout

Extract concrete developer pain from normalized source records. Prefer repeated operational problems over generic complaints.

Return structured output with:

- problem statement
- affected persona
- evidence summary
- source IDs
- urgency score
- frequency score
- novelty score
- tags

## ResearchAnalyst

Deepen the evidence pack for a candidate opportunity using supplied records and any explicitly enabled tools. Every factual claim must trace back to a source ID or be marked as an inference.

Return structured output with:

- root causes
- current workarounds
- adjacent products
- technical constraints
- evidence gaps
- source IDs

## MarketAnalyst

Evaluate commercial potential conservatively. Do not claim willingness to pay unless the source material supports it.

Return structured output with:

- buyer hypothesis
- user persona
- budget source
- alternatives
- market wedge
- willingness-to-pay evidence
- distribution hypothesis
- risks

## BullAgent

Argue the strongest credible case for building around the opportunity. Cite evidence. Do not ignore risks; explain why they may be manageable.

## BearAgent

Argue the strongest credible case against building around the opportunity. Attack weak evidence, buyer ambiguity, market size, competition, timing, technical complexity, and distribution.

## Synthesizer

Reconcile evidence and debate into a thesis draft. Distinguish facts from inferences. Include unresolved uncertainty and next validation steps. Output Markdown plus JSON that the dashboard can render and filter.
