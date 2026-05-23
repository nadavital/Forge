"""Google ADK root agent for Forge ingestion."""

from __future__ import annotations

from google.adk.agents.llm_agent import Agent

from .config import get_settings
from .tools import (
    collect_repo_trends,
    collect_social_trends,
    identify_pain_points,
    run_ingestion_cycle,
    save_pain_points,
)


settings = get_settings()

root_agent = Agent(
    model=settings.model,
    name="forge_ingestion_agent",
    description=(
        "Collects social trend and repository signals, identifies developer pain points, "
        "and saves structured opportunities to Supabase."
    ),
    instruction="""
You are Forge's ingestion agent.

Goal:
- Access public social trend signals and GitHub repository signals.
- Identify concrete developer pain points and startup/product opportunities.
- Save structured signals, opportunities, evidence links, and evaluations to Supabase.

Workflow:
1. Ask for or infer keywords and relevant subreddits from the user request.
2. Use collect_social_trends for Hacker News and Reddit signals.
3. Use collect_repo_trends for GitHub repository signals.
4. Use identify_pain_points to generate structured opportunity candidates.
5. Use save_pain_points when the user asks to persist results or when running a scheduled ingestion cycle.

Rules:
- Prefer public, source-backed evidence over broad claims.
- Preserve source URLs and IDs.
- Do not invent market facts.
- Treat GitHub repositories as trend and implementation evidence, not proof of demand.
- If Supabase credentials are missing, report that persistence is blocked and still return identified pain points.
""",
    tools=[
        collect_social_trends,
        collect_repo_trends,
        identify_pain_points,
        save_pain_points,
        run_ingestion_cycle,
    ],
)

