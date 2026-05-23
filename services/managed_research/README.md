# Forge Managed Research

Managed-agent orchestration for Forge ingestion and research.

This service uses Gemini API managed agents through the Interactions API:

- Deep Research for cited research reports.
- Antigravity for web/repo inspection in a Google-managed sandbox.

Forge keeps Supabase writes outside the sandbox. Managed agents produce research text and JSON-like artifacts; Forge validates and saves records.

## Environment

```bash
GEMINI_API_KEY=
SUPABASE_URL=https://dumomlcpcehrqssrexjl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GITHUB_TOKEN=
```

`SUPABASE_SERVICE_ROLE_KEY` must stay server-side and must not be committed.

## Dry Run

```bash
python -m forge_managed_research.ingest \
  --topic "developer pain with AI agent deployment" \
  --agent antigravity \
  --dry-run
```

## Save To Supabase

Supabase migration has already been applied for the first persistence slice:

- `pipeline_runs`
- `signals`
- `opportunities`
- `opportunity_signals`
- `opportunity_evaluations`

```bash
python -m forge_managed_research.ingest \
  --topic "developer pain with AI agent deployment" \
  --agent antigravity \
  --save
```

## Honest Limits

- Deep Research is best for cited reports, not guaranteed clean database rows.
- Antigravity is best for browsing, repo inspection, code execution, and file artifacts.
- Antigravity currently does not guarantee structured output, so Forge validates extracted JSON before saving.
- Source/API limits still apply. Use `GITHUB_TOKEN` for GitHub. Add source-specific auth when a public source becomes limiting.

