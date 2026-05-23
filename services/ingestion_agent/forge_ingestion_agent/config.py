"""Configuration helpers for the Forge ingestion agent."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    github_token: str | None
    model: str


def get_settings() -> Settings:
    return Settings(
        supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
        github_token=os.getenv("GITHUB_TOKEN") or None,
        model=os.getenv("FORGE_INGESTION_MODEL", "gemini-3-pro-preview"),
    )


def require_supabase(settings: Settings | None = None) -> Settings:
    settings = settings or get_settings()
    missing = []
    if not settings.supabase_url:
        missing.append("SUPABASE_URL")
    if not settings.supabase_service_role_key:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        raise RuntimeError(f"Missing required Supabase env vars: {', '.join(missing)}")
    return settings

