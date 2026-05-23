# Forge Ingestion Agent

Google ADK agent for collecting social trend and repository signals, extracting developer pain points, and saving them to Supabase.

## Local Flow

1. Configure environment variables from `.env.example`.
2. Apply `supabase/migrations/0001_ingestion_agent.sql`.
3. Run tests:

```bash
cd services/ingestion_agent
python -m pytest
```

4. Run a local ingestion cycle:

```bash
python -m forge_ingestion_agent.runner --keywords "supabase,postgres,ai agents" --subreddits "Supabase,LocalLLaMA"
```

## Managed Agent Flow

This package exposes `forge_ingestion_agent.agent.root_agent`, which follows the Google ADK convention for Python agents. Deployment to Vertex AI Agent Engine is handled by `forge_ingestion_agent.deploy`.

```bash
python -m forge_ingestion_agent.deploy
```

The deployment script expects:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_CLOUD_STAGING_BUCKET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Tools

- `collect_social_trends`: fetches Hacker News and Reddit public JSON signals.
- `collect_repo_trends`: fetches GitHub repository search signals.
- `identify_pain_points`: converts collected signals into opportunity candidates.
- `save_pain_points`: writes signals, opportunities, and evidence joins to Supabase.
- `run_ingestion_cycle`: local orchestration helper that performs the full cycle.

The agent can reason over tool output, but persistence uses deterministic structured payloads so records are auditable.

