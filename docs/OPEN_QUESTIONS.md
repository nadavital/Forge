# Open Questions

Answer these before expanding scope. Do not block the first fixture-based vertical slice on every item here.

## Product

- Is the first dashboard private or public?
- Is the first output a single thesis per run or a list of ranked candidates?
- What fields make a thesis useful enough for a human to evaluate?
- Should user Q&A exist in v1 or wait until the read-only dashboard works?

## Sources

- Which Hacker News path is first: newest, Ask HN, Show HN, or keyword search?
- Which subreddits are allowed and worth supporting first?
- Are GitHub issues, Stack Overflow, Discord exports, or changelogs in scope later?
- What rate limits, caching rules, and source terms apply to each connector?

## Agents

- What is the maximum debate turn count for the first version?
- Does the Synthesizer have permission to reject an opportunity as too weak?
- What JSON schema is the source of truth for thesis output?
- Which claims require source IDs, and which may be marked as inference?

## Infrastructure

- Which Google Cloud project and region are authorized for Vertex AI Agent Engine?
- Should the pipeline run on manual trigger first, then schedule later?
- Should Q&A requests be handled by Next.js API routes, Supabase Edge Functions, or the agent service?
- What authentication model protects write endpoints?

## Frontend

- Should the first UI optimize for internal analyst use or public reading?
- Should realtime update by whole message first, leaving typing effects for later?
- Should thesis Markdown render as an article, structured fields, or both?
