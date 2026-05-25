# Docs Maintenance

Forge is moving quickly. Documentation is part of the product contract, not an afterthought.

Any change that affects product behavior, data shape, agent flow, build behavior, source ingestion, approvals, reflection, or user-visible UI state should update the relevant docs in the same PR or commit.

## Required Updates By Change Type

### Product Behavior

Update:

- `README.md`
- `docs/PRODUCT_OVERVIEW.md`
- `docs/OPEN_QUESTIONS.md` if the change answers or creates a product question

Examples:

- New project mode behavior.
- Recommendation empty-state changes.
- New review action.
- Changed approval boundary.
- Changed generated MVP contract.

### Architecture Or Runtime Flow

Update:

- `docs/ARCHITECTURE.md`
- `docs/AGENT_SYSTEM.md`
- `docs/FRONTEND_BACKEND_CONTRACT.md` when dashboard/backend shape changes

Examples:

- New agent path.
- Changed pipeline order.
- New backend service boundary.
- New managed-agent API behavior.
- Changed scheduler or trigger runtime.

### Data Shape Or Persistence

Update:

- `docs/DATA_MODEL.md`
- `supabase/migrations/*`
- `apps/dashboard/lib/db/types.ts`
- `docs/FRONTEND_BACKEND_CONTRACT.md` for API-facing shape changes

Examples:

- New table or column.
- New status value.
- Changed metadata payload.
- New artifact type.

### Agent Prompts Or Roles

Update:

- `docs/AGENT_SYSTEM.md`
- `docs/prompts/AGENT_PROMPTS.md`
- Code near the validator/parser for that agent output

Examples:

- New agent role.
- Changed structured JSON output.
- New validation rule.
- Changed model/tool selection.

### Dashboard Or Local Development

Update:

- `apps/dashboard/README.md`
- `README.md` if setup or required env changes

Examples:

- New command.
- New env var.
- Changed local store behavior.
- Changed Supabase setup.

## Current Versus Target Language

Use precise language:

- `Current` means code exists in this repo and can be inspected.
- `Implemented` means code exists and has at least local verification.
- `Configured` means code path exists but needs credentials or external services.
- `Planned` means product intent only.
- `Target` means architecture direction, not a claim of working behavior.

Avoid saying Forge "does" something unless the repo has a runnable path for it.

## Documentation Checklist

Before finishing a Forge change, check:

- Does `README.md` still describe the product honestly?
- Does `docs/PRODUCT_OVERVIEW.md` match the current user experience?
- Does `docs/AGENT_SYSTEM.md` list the actual agent path touched?
- Does `docs/ARCHITECTURE.md` separate current implementation from target architecture?
- Does `docs/DATA_MODEL.md` match migrations and TypeScript DB types?
- Does `apps/dashboard/README.md` match local setup and env requirements?
- Did any stale scaffold/demo/fallback language become misleading?

## Anti-Patterns

- Adding speculative infrastructure docs for commands that have never run.
- Describing fake, deterministic, or fallback recommendations as product intelligence.
- Hiding credential requirements for live managed-agent paths.
- Letting target architecture overwrite the current-state docs.
- Adding new status strings in code without updating docs and migrations.
- Updating prompts without updating validators and output contracts.
