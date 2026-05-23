"""Validation and normalization for managed-agent research output."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ManagedSignal:
    source: str
    title: str
    body: str
    url: str | None = None
    source_id: str | None = None
    author: str | None = None
    published_at: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ManagedSignal":
        return cls(
            source=str(value.get("source") or "managed_agent"),
            title=str(value.get("title") or "Untitled signal"),
            body=str(value.get("body") or ""),
            url=value.get("url") or None,
            source_id=value.get("source_id") or None,
            author=value.get("author") or None,
            published_at=value.get("published_at") or None,
            tags=[str(item) for item in value.get("tags", []) if item],
            metadata=value.get("metadata") if isinstance(value.get("metadata"), dict) else {},
        )

    def to_supabase_row(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "source_id": self.source_id,
            "url": self.url,
            "title": self.title,
            "body": self.body,
            "author": self.author,
            "published_at": self.published_at,
            "tags": self.tags,
            "metadata": self.metadata,
        }


@dataclass
class ManagedOpportunity:
    title: str
    problem: str
    target_user: str
    mvp_concept: str
    score: float
    score_rationale: str
    source_indexes: list[int] = field(default_factory=list)
    profile: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ManagedOpportunity":
        raw_score = value.get("score", 0)
        try:
            score = max(0.0, min(1.0, float(raw_score)))
        except (TypeError, ValueError):
            score = 0.0
        return cls(
            title=str(value.get("title") or "Untitled opportunity"),
            problem=str(value.get("problem") or ""),
            target_user=str(value.get("target_user") or "Unknown user"),
            mvp_concept=str(value.get("mvp_concept") or ""),
            score=score,
            score_rationale=str(value.get("score_rationale") or ""),
            source_indexes=[
                int(item)
                for item in value.get("source_indexes", [])
                if isinstance(item, int) or str(item).isdigit()
            ],
            profile=value.get("profile") if isinstance(value.get("profile"), dict) else {},
        )

    def to_supabase_row(self, pipeline_run_id: str | None) -> dict[str, Any]:
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


@dataclass
class ManagedResearchResult:
    raw_text: str
    signals: list[ManagedSignal]
    opportunities: list[ManagedOpportunity]
    agent: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any], raw_text: str, agent: str) -> "ManagedResearchResult":
        signals = [
            ManagedSignal.from_dict(item)
            for item in payload.get("signals", [])
            if isinstance(item, dict)
        ]
        opportunities = [
            ManagedOpportunity.from_dict(item)
            for item in payload.get("opportunities", [])
            if isinstance(item, dict)
        ]
        return cls(raw_text=raw_text, signals=signals, opportunities=opportunities, agent=agent)

