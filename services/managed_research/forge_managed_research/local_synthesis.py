"""Deterministic synthesis over collected public media."""

from __future__ import annotations

from collections import Counter, defaultdict

from .schemas import ManagedOpportunity, ManagedSignal, MediaItem, SeedTopic


PAIN_TERMS = {
    "deploy": ["deploy", "deployment", "hosting", "production", "serverless"],
    "eval": ["eval", "evaluation", "testing", "test", "benchmark"],
    "observe": ["observability", "trace", "logging", "monitor", "debug"],
    "cost": ["cost", "budget", "token", "spend", "pricing"],
    "security": ["security", "permission", "auth", "sandbox", "secret"],
    "rag": ["rag", "retrieval", "embedding", "vector", "context"],
    "integration": ["mcp", "integration", "tool", "api", "schema"],
}


def synthesize_seed_topics(media_items: list[MediaItem], max_topics: int) -> list[SeedTopic]:
    buckets = _bucket_media(media_items)
    scored: list[SeedTopic] = []
    for bucket, indexes in buckets.items():
        if not indexes:
            continue
        titles = [media_items[index].title for index in indexes[:3]]
        sources = [
            media_items[index].url
            for index in indexes
            if media_items[index].url
        ][:5]
        score = min(1.0, 0.45 + 0.12 * len(indexes) + 0.03 * len(sources))
        label = _bucket_label(bucket)
        scored.append(
            SeedTopic(
                topic=f"developer pain with {label}",
                title=label.title(),
                rationale=f"Collected {len(indexes)} public items related to {label}: {'; '.join(titles)}",
                score=round(score, 2),
                sources=sources,
                tags=[bucket, "deterministic_seed"],
                metadata={"media_item_indexes": indexes[:10]},
            )
        )
    scored.sort(key=lambda item: item.score, reverse=True)
    return scored[:max_topics]


def synthesize_signals(media_items: list[MediaItem]) -> list[ManagedSignal]:
    signals: list[ManagedSignal] = []
    for index, item in enumerate(media_items):
        if item.source == "collector_error":
            continue
        text = item.summary or item.captured_text or item.title
        bucket = _best_bucket(text)
        signals.append(
            ManagedSignal(
                source=item.source,
                title=item.title,
                body=text,
                url=item.url,
                published_at=item.published_at,
                tags=[*item.tags, "collected_media"],
                metadata={
                    **item.metadata,
                    "pipeline": "source_collect",
                    "media_item_indexes": [index],
                    "observed_pain": _observed_pain(bucket),
                    "evidence_type": item.metadata.get("content_type", "media"),
                },
            )
        )
    return signals


def synthesize_opportunities(
    media_items: list[MediaItem],
    signals: list[ManagedSignal],
    max_opportunities: int,
) -> list[ManagedOpportunity]:
    buckets = _bucket_media(media_items)
    opportunities: list[ManagedOpportunity] = []
    for bucket, media_indexes in buckets.items():
        signal_indexes = [
            index
            for index, signal in enumerate(signals)
            if bucket in " ".join(signal.tags).lower()
            or bucket == _best_bucket(f"{signal.title} {signal.body}")
        ]
        if not signal_indexes:
            continue
        label = _bucket_label(bucket)
        score = min(1.0, 0.5 + 0.1 * len(signal_indexes))
        opportunities.append(
            ManagedOpportunity(
                title=f"{label.title()} workflow helper",
                problem=f"Developers have repeated pain with {label}.",
                target_user="Developers building production AI and developer-tool workflows",
                mvp_concept=_mvp_for_bucket(bucket),
                score=round(score, 2),
                score_rationale=f"Detected {len(signal_indexes)} public signals and {len(media_indexes)} collected media items for this pain area.",
                source_indexes=signal_indexes[:5],
                profile={
                    "facts": [f"{len(media_indexes)} collected media items mention {label}."],
                    "inferences": ["A narrow workflow tool can test this pain before a full platform."],
                    "risks": ["Deterministic synthesis is coarse; managed research should review top clusters."],
                    "media_item_indexes": media_indexes[:10],
                },
            )
        )
    opportunities.sort(key=lambda item: item.score, reverse=True)
    return opportunities[:max_opportunities]


def _bucket_media(media_items: list[MediaItem]) -> dict[str, list[int]]:
    buckets: dict[str, list[int]] = defaultdict(list)
    for index, item in enumerate(media_items):
        if item.source == "collector_error":
            continue
        buckets[_best_bucket(f"{item.title} {item.summary} {' '.join(item.tags)}")].append(index)
    return dict(buckets)


def _best_bucket(text: str) -> str:
    lowered = text.lower()
    scores = Counter()
    for bucket, terms in PAIN_TERMS.items():
        for term in terms:
            if term in lowered:
                scores[bucket] += 1
    if not scores:
        return "integration"
    return scores.most_common(1)[0][0]


def _bucket_label(bucket: str) -> str:
    return {
        "deploy": "AI agent deployment",
        "eval": "AI agent evaluation",
        "observe": "LLM observability and debugging",
        "cost": "LLM cost control",
        "security": "agent security and permissions",
        "rag": "production RAG reliability",
        "integration": "agent tool integration",
    }.get(bucket, bucket)


def _observed_pain(bucket: str) -> str:
    return {
        "deploy": "Production deployment remains hard to configure and trust.",
        "eval": "Agent behavior is difficult to test and evaluate repeatedly.",
        "observe": "Teams lack enough traces and debugging context for LLM workflows.",
        "cost": "LLM and agent costs can be unpredictable or hard to cap.",
        "security": "Agent permissions and tool calls are difficult to constrain safely.",
        "rag": "Retrieval quality and context reliability are difficult to maintain.",
        "integration": "Tool, API, and schema integrations are brittle.",
    }.get(bucket, "Developer workflow pain appears repeatedly.")


def _mvp_for_bucket(bucket: str) -> str:
    return {
        "deploy": "Deployment readiness checker with config linting and smoke tests.",
        "eval": "Agent regression test runner with repeated-case summaries.",
        "observe": "Trace viewer and failure classifier for agent runs.",
        "cost": "Budget guardrail proxy that stops runaway agent calls.",
        "security": "Tool-call policy gateway with allowlists and audit logs.",
        "rag": "RAG quality monitor with retrieval drift checks.",
        "integration": "Schema and tool integration validator for agent workflows.",
    }.get(bucket, "Small workflow helper focused on the repeated developer pain.")
