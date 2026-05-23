# Forge Dashboard

Internal morning-review UI for Forge Phase 4.

## Quick start (local demo)

From the Forge repo root:

```bash
pnpm install
pnpm setup
pnpm dev
```

Open **http://localhost:3000** — you'll land on **Acme Console** with two ranked opportunities.

### What to click through

1. **Acme Console → Review** — morning digest + opportunity cards
2. **API key recovery** — full breakdown, Pass / Watch / Research, refine box, **Build**
3. After Build — expand artifact sections (README, run instructions, smoke checks)
4. **Review | Settings** tabs — edit sources, triggers, taste; review reflection proposals
5. **Forge settings** (sidebar footer) — workspace guardrails + reflection queue
6. **+** in sidebar — create a new connected or new-product project

### Reset demo data

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

Without env vars, the dashboard uses **`.forge-data/store.json`** (gitignored) seeded from `data/seed.json`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (webpack, Safari-safe CSS) |
| `pnpm setup` | Seed local demo data |
| `pnpm seed:reset` | Delete local store (dashboard package) |

## Dashboard vs backend split

**Dashboard (this app) — done for Phase 4 demo**

- Project onboarding, settings UI, morning review, opportunity detail
- Review actions → `preference_events`
- Build button → simulated builder → `mvp_builds` + `build_artifacts`
- Reflection proposal accept/reject
- Run again (simulated pipeline run in local mode)

**Backend (your partner) — still to wire**

- Apply SQL migration to hosted Supabase
- Set `project_id` on pipeline ingestion rows
- Real pipeline trigger (Python `managed_research/ingest.py`) instead of simulated run
- Live Antigravity builder (Phase 6)
- Realtime subscriptions on build status
