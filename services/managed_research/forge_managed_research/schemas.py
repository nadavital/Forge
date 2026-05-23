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


@dataclass
class MediaItem:
    source: str
    title: str
    url: str | None = None
    summary: str = ""
    captured_text: str = ""
    published_at: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "MediaItem":
        return cls(
            source=str(value.get("source") or "managed_media"),
            title=str(value.get("title") or "Untitled media item"),
            url=value.get("url") or None,
            summary=str(value.get("summary") or value.get("body") or ""),
            captured_text=str(value.get("captured_text") or value.get("text") or ""),
            published_at=value.get("published_at") or None,
            tags=[str(item) for item in value.get("tags", []) if item],
            metadata=value.get("metadata") if isinstance(value.get("metadata"), dict) else {},
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "title": self.title,
            "url": self.url,
            "summary": self.summary,
            "captured_text": self.captured_text,
            "published_at": self.published_at,
            "tags": self.tags,
            "metadata": self.metadata,
        }


@dataclass
class TrendScoutResult:
    raw_text: str
    media_items: list[MediaItem]
    agent: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any], raw_text: str, agent: str) -> "TrendScoutResult":
        media_items = [
            MediaItem.from_dict(item)
            for item in payload.get("media_items", [])
            if isinstance(item, dict)
        ]
        return cls(raw_text=raw_text, media_items=media_items, agent=agent)


@dataclass
class ResearchFinding:
    title: str
    summary: str
    citations: list[str] = field(default_factory=list)
    media_item_indexes: list[int] = field(default_factory=list)
    observed_pain: str = ""
    inference: str = ""
    risk: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ResearchFinding":
        return cls(
            title=str(value.get("title") or "Untitled research finding"),
            summary=str(value.get("summary") or value.get("body") or ""),
            citations=[str(item) for item in value.get("citations", []) if item],
            media_item_indexes=[
                int(item)
                for item in value.get("media_item_indexes", [])
                if isinstance(item, int) or str(item).isdigit()
            ],
            observed_pain=str(value.get("observed_pain") or ""),
            inference=str(value.get("inference") or ""),
            risk=str(value.get("risk") or ""),
            metadata=value.get("metadata") if isinstance(value.get("metadata"), dict) else {},
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "summary": self.summary,
            "citations": self.citations,
            "media_item_indexes": self.media_item_indexes,
            "observed_pain": self.observed_pain,
            "inference": self.inference,
            "risk": self.risk,
            "metadata": self.metadata,
        }


@dataclass
class TrendResearchPipelineResult:
    topic: str
    trend: TrendScoutResult
    research: ManagedResearchResult
    research_findings: list[ResearchFinding]

    @classmethod
    def from_payloads(
        cls,
        topic: str,
        trend_payload: dict[str, Any],
        trend_raw_text: str,
        trend_agent: str,
        research_payload: dict[str, Any],
        research_raw_text: str,
        research_agent: str,
    ) -> "TrendResearchPipelineResult":
        return cls(
            topic=topic,
            trend=TrendScoutResult.from_payload(
                trend_payload,
                raw_text=trend_raw_text,
                agent=trend_agent,
            ),
            research=ManagedResearchResult.from_payload(
                research_payload,
                raw_text=research_raw_text,
                agent=research_agent,
            ),
            research_findings=[
                ResearchFinding.from_dict(item)
                for item in research_payload.get("research_findings", [])
                if isinstance(item, dict)
            ],
        )


@dataclass
class SeedTopic:
    topic: str
    title: str
    rationale: str
    score: float
    sources: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "SeedTopic":
        raw_score = value.get("score", 0)
        try:
            score = max(0.0, min(1.0, float(raw_score)))
        except (TypeError, ValueError):
            score = 0.0
        topic = str(value.get("topic") or value.get("title") or "Untitled topic")
        return cls(
            topic=topic,
            title=str(value.get("title") or topic),
            rationale=str(value.get("rationale") or value.get("score_rationale") or ""),
            score=score,
            sources=[str(item) for item in value.get("sources", []) if item],
            tags=[str(item) for item in value.get("tags", []) if item],
            metadata=value.get("metadata") if isinstance(value.get("metadata"), dict) else {},
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "topic": self.topic,
            "title": self.title,
            "rationale": self.rationale,
            "score": self.score,
            "sources": self.sources,
            "tags": self.tags,
            "metadata": self.metadata,
        }


@dataclass
class SeedDiscoveryResult:
    raw_text: str
    seed_topics: list[SeedTopic]
    agent: str
    theme: str

    @classmethod
    def from_payload(
        cls,
        payload: dict[str, Any],
        raw_text: str,
        agent: str,
        theme: str,
    ) -> "SeedDiscoveryResult":
        return cls(
            raw_text=raw_text,
            seed_topics=[
                SeedTopic.from_dict(item)
                for item in payload.get("seed_topics", [])
                if isinstance(item, dict)
            ],
            agent=agent,
            theme=theme,
        )


@dataclass
class SourceCollectionResult:
    query: str
    media_items: list[MediaItem]
    seed_topics: list[SeedTopic]
    signals: list[ManagedSignal]
    opportunities: list[ManagedOpportunity]
    collector: str = "public_collectors"

    @property
    def raw_text(self) -> str:
        return ""


@dataclass
class OpportunityRecord:
    id: str
    title: str
    problem: str
    target_user: str
    mvp_concept: str
    score: float
    score_rationale: str
    pipeline_run_id: str | None = None
    project_id: str | None = None
    evidence_signal_ids: list[str] = field(default_factory=list)
    evidence_count: int = 0
    profile: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_supabase_row(cls, value: dict[str, Any]) -> "OpportunityRecord":
        raw_score = value.get("score", 0)
        try:
            score = max(0.0, min(1.0, float(raw_score)))
        except (TypeError, ValueError):
            score = 0.0
        return cls(
            id=str(value.get("id") or ""),
            title=str(value.get("title") or "Untitled opportunity"),
            problem=str(value.get("problem") or ""),
            target_user=str(value.get("target_user") or "Unknown user"),
            mvp_concept=str(value.get("mvp_concept") or ""),
            score=score,
            score_rationale=str(value.get("score_rationale") or ""),
            pipeline_run_id=value.get("pipeline_run_id") or None,
            project_id=value.get("project_id") or None,
            profile=value.get("profile") if isinstance(value.get("profile"), dict) else {},
        )


@dataclass
class SignalRecord:
    id: str
    source: str
    title: str
    body: str
    url: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_supabase_row(cls, value: dict[str, Any]) -> "SignalRecord":
        return cls(
            id=str(value.get("id") or ""),
            source=str(value.get("source") or "unknown"),
            title=str(value.get("title") or "Untitled signal"),
            body=str(value.get("body") or ""),
            url=value.get("url") or None,
            tags=[str(item) for item in value.get("tags", []) if item],
            metadata=value.get("metadata") if isinstance(value.get("metadata"), dict) else {},
        )


@dataclass
class OpportunityCluster:
    canonical_title: str
    problem: str
    target_user: str
    mvp_concept: str
    score: float
    representative_opportunity_id: str
    merged_opportunity_ids: list[str]
    evidence_signal_ids: list[str]
    variants: list[str]
    tags: list[str]
    why_clustered: str
    evidence: list[SignalRecord] = field(default_factory=list)

    def to_metadata(self) -> dict[str, Any]:
        return {
            "canonical_title": self.canonical_title,
            "problem": self.problem,
            "target_user": self.target_user,
            "mvp_concept": self.mvp_concept,
            "score": self.score,
            "representative_opportunity_id": self.representative_opportunity_id,
            "merged_opportunity_ids": self.merged_opportunity_ids,
            "evidence_signal_ids": self.evidence_signal_ids,
            "variants": self.variants,
            "tags": self.tags,
            "why_clustered": self.why_clustered,
            "evidence": [
                {
                    "id": signal.id,
                    "source": signal.source,
                    "title": signal.title,
                    "body": signal.body,
                    "url": signal.url,
                    "tags": signal.tags,
                    "metadata": signal.metadata,
                }
                for signal in self.evidence
            ],
        }


@dataclass
class BullBearEvaluation:
    cluster: OpportunityCluster
    bull: dict[str, Any]
    bear: dict[str, Any]
    decision: dict[str, Any]
    synthesis: dict[str, Any] = field(default_factory=dict)
    raw_outputs: dict[str, str] = field(default_factory=dict)
