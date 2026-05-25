# Forge Dashboard

Internal product-review UI for Forge.

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

### Connect to Supabase

Apply the migrations in `supabase/migrations` and provide server-side credentials.

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
- Connected product setup with a GitHub repo URL → README/issues/tree ingestion → Gemini/Antigravity repo analysis → repo-specific recommendations when semantic discovery returns them
- New product runs currently capture project/preference context as signals but do not create recommendation cards until agent-backed discovery is implemented
- Run again re-ingests the connected repo when a repo URL is configured, or refreshes new-product context signals when no repo is configured
- Archive project (hides it and disables triggers without deleting history)

**Still to wire**

- Apply SQL migration to hosted Supabase
- Set `project_id` on pipeline ingestion rows
- Decide whether dashboard Dream should call the Python `managed_research/ingest.py` service or stay in the TypeScript server-action path
- Realtime subscriptions on build status

## Managed builds

The build button always records the human approval and creates an auditable build brief. Local runs without credentials use the deterministic simulated adapter. To launch the Gemini managed builder, set:

```bash
FORGE_BUILDER_ADAPTER=managed
GEMINI_API_KEY=...
FORGE_GEMINI_BUILDER_AGENT=antigravity-preview-05-2026
FORGE_TEMPLATE_REPO_URL=https://github.com/forge-labs/mvp-template
FORGE_GENERATED_REPO_OWNER=rkibel
GITHUB_TOKEN=...
```

Existing-product builds use the connected project `repo_url` and open a PR titled `Build MVP: <opportunity title>`. New-product builds target a generated repo named from the project and opportunity. The managed agent can either return PR metadata directly or return a `files[]` bundle; when it returns files, Forge uses the server-side GitHub token to create the generated repo or branch and open the PR without exposing GitHub credentials to the sandbox.

## GitHub repo demo

Create a connected product with a repo URL such as:

```text
https://github.com/rkibel/auto-drone
```

Forge fetches the repository metadata, README, and latest issues, then creates ranked opportunities from that repo context. Public repos work without credentials. Set `GITHUB_TOKEN` in `.env.local` to raise API limits or read private repos available to the token.

## New product demo

For new products, leaving the idea direction blank is valid. Forge currently writes explicit `manual_preference` and `demo_constraint` signals, then shows an empty recommendation state until model-backed discovery is added. Editing preferred markets or notes in project settings steers the next run context.
