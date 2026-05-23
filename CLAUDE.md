# CLAUDE.md

Claude-specific entrypoint.

Read [AGENTS.md](./AGENTS.md) first. It is the source of truth for agent instructions in this repo.

Claude should be especially strict about:

- Not inventing Antigravity, Vertex, or template-repo implementation details.
- Not turning product aspirations into claims that the repo already works.
- Keeping preferences, opportunities, build briefs, build logs, and generated artifacts distinct.
- Preserving the approval contract: human approves an opportunity; the managed builder handles implementation within v1 limits.
- Keeping the docs oriented around MVP builds and generated PRs.
