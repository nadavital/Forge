# CLAUDE.md

Claude-specific entrypoint.

Read [AGENTS.md](./AGENTS.md) first. It is the source of truth for agent instructions in this repo.

Claude should be especially strict about:

- Not inventing Antigravity, Vertex, or template-repo implementation details.
- Not turning product aspirations into claims that the repo already works.
- Updating docs when product behavior, agent flow, architecture, data shape, runtime config, or dashboard setup changes.
- Keeping project context, preferences, source evidence, opportunities, evaluations, decisions, prototypes, build briefs, build logs, generated artifacts, and reflection proposals distinct.
- Preserving the approval contract: human approves a direction or opportunity; the managed builder handles implementation within v1 limits.
- Keeping the docs oriented around product-first continuous use, not just MVP builds and generated PRs.
- Not treating Forge reflection/dreaming as product research. Reflection improves Forge behavior; it does not create product opportunities by itself.
- Not allowing generated prototypes or MVPs to be described as proof of market demand.
