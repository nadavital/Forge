# Forge Dashboard

Internal morning-review UI for Forge Phase 4.

## Quick start

From the Forge repo root:

```bash
pnpm install
pnpm setup
pnpm dev
```

Open **http://localhost:3000**. The local dashboard starts empty unless you have already created projects in
`.forge-data/store.json` or connected Supabase.

### What to click through

1. **Projects** — workspace overview across persisted projects
2. **+** in sidebar — add an existing GitHub repo or start a new product idea
3. **Project → Review** — opportunity cards after a real project run has produced records
4. **Project → Settings** — edit sources, schedule triggers, taste, and reflection proposals

### Reset local data

```bash
pnpm --filter @forge/dashboard seed:reset
pnpm setup
```

### Connect to Supabase (when backend is ready)

Your partner should apply `supabase/migrations/001_initial.sql` and share credentials.

```bash
cp apps/dashboard/.env.local.example apps/dashboard/.env.local
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
pnpm dev
```

Without env vars, the dashboard uses **`.forge-data/store.json`** (gitignored). It starts empty and only shows
projects created through the app or records written by the local pipeline.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (webpack, Safari-safe CSS) |
| `pnpm setup` | Prepare local dashboard storage |
| `pnpm seed:reset` | Delete local store (dashboard package); it will be recreated empty |

## Dashboard vs backend split

**Dashboard (this app)**

- Project onboarding with optional GitHub repo connection, project settings UI, project review, opportunity detail
- Review actions → `preference_events`
- Build button → build brief → Gemini managed builder when `GEMINI_API_KEY` is set, otherwise simulated builder → `mvp_builds` + `build_artifacts`
- Reflection proposal accept/reject
- Project scheduler control → runs due active schedule triggers for the selected project
- Connected product setup with a GitHub repo URL → README/issues ingestion → repo-specific opportunity ranking
- New product runs generate buildable ideas from the preference/profile context when you do not know what to build yet
- Run again re-ingests the connected repo when a repo URL is configured, or refreshes generated ideas for new products
- Archive project (hides it and disables triggers without deleting history)

**Backend (your partner) — still to wire**

- Apply SQL migration to hosted Supabase
- Set `project_id` on pipeline ingestion rows
- Real pipeline trigger (Python `managed_research/ingest.py`) instead of simulated run
- Realtime subscriptions on build status

## Managed builds

The build button always records the human approval and creates an auditable build brief. Local runs without credentials use the deterministic simulated adapter. To launch the Gemini managed builder, set:

```bash
FORGE_BUILDER_ADAPTER=managed
GEMINI_API_KEY=...
FORGE_GEMINI_BUILDER_AGENT=antigravity-preview-05-2026
FORGE_TEMPLATE_REPO_URL=https://github.com/forge-labs/mvp-template
```

Managed builds require the selected project to have `repo_url`; the managed agent is instructed to build in that target repo, open a PR titled `Build MVP: <opportunity title>`, and return PR metadata plus review artifacts.

## GitHub repo demo

Create a connected product with a repo URL such as:

```text
https://github.com/rkibel/auto-drone
```

Forge fetches the repository metadata, README, and latest issues, then creates ranked opportunities from that repo context. Public repos work without credentials. Set `GITHUB_TOKEN` in `.env.local` to raise API limits or read private repos available to the token.

## New product demo

For new products, leaving the idea direction blank is valid. Forge generates ideas from the project preference profile and constraints, then writes explicit `manual_preference`, `builder_profile`, and `demo_constraint` signals before creating opportunities. Editing preferred markets or notes in project settings steers the next run.
