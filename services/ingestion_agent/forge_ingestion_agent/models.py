"""Structured records used by ingestion tools."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Signal:
    source: str
    title: str
    body: str = ""
    source_id: str | None = None
    url: str | None = None
    author: str | None = None
    published_at: str | None = None
    captured_at: str = field(default_factory=utc_now_iso)
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_supabase_row(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PainPoint:
    title: str
    problem: str
    target_user: str
    mvp_concept: str
    score: float
    score_rationale: str
    source_signal_keys: list[str] = field(default_factory=list)
    profile: dict[str, Any] = field(default_factory=dict)

    def to_opportunity_row(self, pipeline_run_id: str | None = None) -> dict[str, Any]:
        return {
            "pipeline_run_id": pipeline_run_id,
            "title": self.title,
            "problem": self.problem,
            "target_user": self.target_user,
            "mvp_concept": self.mvp_concept,
            "score": self.score,
            "score_rationale": self.score_rationale,
            "status": "proposed",
            "profile": self.profile,
        }


def signal_key(signal: Signal) -> str:
    if signal.source_id:
        return f"{signal.source}:{signal.source_id}"
    if signal.url:
        return f"{signal.source}:{signal.url}"
    return f"{signal.source}:{signal.title}"

