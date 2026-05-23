"""Deploy the Forge ingestion ADK agent to Vertex AI Agent Engine."""

from __future__ import annotations

import os

import vertexai
from vertexai import agent_engines

from .agent import root_agent


def deploy() -> object:
    project_id = os.environ["GOOGLE_CLOUD_PROJECT"]
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    staging_bucket = os.environ["GOOGLE_CLOUD_STAGING_BUCKET"]

    vertexai.init(
        project=project_id,
        location=location,
        staging_bucket=staging_bucket,
    )

    app = agent_engines.AdkApp(
        agent=root_agent,
        enable_tracing=True,
    )

    return agent_engines.create(
        agent_engine=app,
        requirements=[
            "google-adk>=1.0.0",
            "google-cloud-aiplatform[adk,agent_engines]>=1.111.0",
        ],
        extra_packages=["./forge_ingestion_agent"],
        display_name="Forge Ingestion Agent",
        env_vars={
            "SUPABASE_URL": os.environ["SUPABASE_URL"],
            "SUPABASE_SERVICE_ROLE_KEY": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            "GITHUB_TOKEN": os.getenv("GITHUB_TOKEN", ""),
            "FORGE_INGESTION_MODEL": os.getenv("FORGE_INGESTION_MODEL", "gemini-3-pro-preview"),
        },
    )


if __name__ == "__main__":
    remote_app = deploy()
    print(remote_app)
