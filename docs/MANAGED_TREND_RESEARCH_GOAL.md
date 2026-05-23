# Managed Trend Research Goal

## Objective

Implement a two-stage managed-agent ingestion pipeline:

1. A managed media/trend agent retrieves current public media, social, forum, and repository content around a configured market or product theme.
2. A managed research agent uses only the retrieved trend set as grounding evidence, expands the most promising threads with cited research, and produces structured signals and opportunities.

Forge must keep validation and Supabase writes in local controlled code. Managed agents collect and research; Forge parses, validates, links, and persists.

## Pipeline Contract

The first runnable slice should expose one command that creates a single `pipeline_runs` record and saves both stages of evidence:

- `media_items`: retrieved public content from the trend agent, including source, title, URL, captured text or summary, timestamp when available, and tags.
- `research_findings`: research output grounded in one or more retrieved media items, including citations, observed pain, inference, risk, and source item references.
- `signals`: normalized pain-point records derived from media and research.
- `opportunities`: candidate MVP opportunities linked back to the signals and research evidence.

If the current database schema is not ready for dedicated `media_items` or `research_findings` tables, implement the first version by storing stage-specific records in existing `signals.metadata` and `pipeline_runs.metadata`, but keep the code shaped so dedicated tables can be added later.

## Agent Roles

- `TrendScout`: managed media/trend agent. Finds recent public discussion, repo activity, launch posts, issue threads, articles, and forum complaints. It should return evidence, not conclusions.
- `ResearchAnalyst`: managed research agent. Takes `TrendScout` output as input and researches only the strongest trend threads. It must distinguish sourced facts from inference.
- `ForgeValidator`: local code. Extracts JSON, rejects malformed records, preserves raw output references, and writes to Supabase.

## Acceptance Validation

Validation is not just tests. The implementation is done when one local command can run the full managed pipeline and the user can inspect:

1. A `pipeline_runs` row for the run.
2. Retrieved media/trend content from `TrendScout`.
3. Research output from `ResearchAnalyst` that clearly corresponds to the retrieved media content.
4. Normalized `signals` linked to the run.
5. At least one opportunity or explicit "no opportunity" result with rationale.

The command should print a concise summary with counts and IDs, including the `pipeline_run_id`, media item count, research finding count, signal count, and opportunity count.

## Non-Goals

- Broad scraping without source limits or auth strategy.
- Paid APIs or secret-requiring sources.
- Letting managed agents write directly to Supabase.
- Treating research summaries as source evidence unless linked to retrieved media or citations.
- Building the dashboard before the pipeline run can be inspected in Supabase.
