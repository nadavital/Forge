"""Deterministic synthesis over collected public media."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

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
        bucket = _best_bucket(f"{text} {' '.join(item.tags)}")
        signals.append(
            ManagedSignal(
                source=item.source,
                title=item.title,
                body=text,
                url=item.url,
                published_at=item.published_at,
                tags=[*item.tags, bucket, "collected_media"],
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
    signals: list[ManagedSignal | dict[str, Any]],
    max_opportunities: int,
) -> list[ManagedOpportunity]:
    buckets: dict[str, list[int]] = defaultdict(list)
    for index, signal in enumerate(signals):
        bucket = _best_bucket(
            " ".join(
                [
                    _signal_text(signal, "title"),
                    _signal_text(signal, "body"),
                    " ".join(_signal_tags(signal)),
                ]
            )
        )
        buckets[bucket].append(index)

    opportunities: list[ManagedOpportunity] = []
    for bucket, indexes in buckets.items():
        if not indexes:
            continue
        cited_indexes = _ranked_signal_indexes(indexes, signals, media_items)
        url_count = len({_signal_url(signals[index]) for index in cited_indexes if _signal_url(signals[index])})
        evidence_assessment = _source_evidence_assessment(cited_indexes, signals)
        score = min(0.9, 0.45 + 0.1 * len(indexes) + 0.03 * url_count)
        label = _bucket_label(bucket)
        opportunities.append(
            ManagedOpportunity(
                title=f"{label} Workflow Helper",
                problem=_observed_pain(bucket),
                target_user="AI developers and product teams",
                mvp_concept=_mvp_concept(bucket),
                score=round(score, 2),
                score_rationale=(
                    f"Grouped {len(indexes)} public signal(s) related to {label}. "
                    "Treat as early source evidence, not validated demand."
                ),
                source_indexes=cited_indexes[:6],
                profile={
                    "origin": "deterministic_source_synthesis",
                    "bucket": bucket,
                    "evidence_state": "source_collected",
                    "media_item_count": len(media_items),
                    "citation_count": url_count,
                    **evidence_assessment,
                },
            )
        )

    opportunities.sort(key=lambda item: item.score, reverse=True)
    return opportunities[:max_opportunities]


def synthesize_brief_opportunities(
    brief: dict,
    media_items: list[MediaItem],
    signals: list[ManagedSignal | dict[str, Any]],
    max_opportunities: int,
) -> list[ManagedOpportunity]:
    """Create source-backed candidates from a user-approved research brief."""
    if not signals:
        return []

    target_users = [
        str(item).strip()
        for item in brief.get("target_users", [])
        if str(item).strip()
    ]
    source_plan = [
        str(item).strip()
        for item in brief.get("source_plan", [])
        if str(item).strip()
    ]
    constraints = [
        str(item).strip()
        for item in brief.get("constraints", [])
        if str(item).strip()
    ]
    boundaries = [
        str(item).strip()
        for item in brief.get("mvp_boundaries", [])
        if str(item).strip()
    ]
    disqualifiers = [
        str(item).strip()
        for item in brief.get("disqualifying_evidence", [])
        if str(item).strip()
    ]
    taste_notes = [
        str(item).strip()
        for item in brief.get("user_taste_notes", [])
        if str(item).strip()
    ]
    open_questions = [
        str(item).strip()
        for item in brief.get("open_questions", [])
        if str(item).strip()
    ]
    hypothesis = str(brief.get("hypothesis") or "Research-backed product direction").strip()
    pain_area = str(brief.get("pain_area") or hypothesis).strip()
    target_user = ", ".join(target_users[:3]) or "Users from the research brief"
    mvp = boundaries[0] if boundaries else f"A narrow prototype to test: {hypothesis}"
    cited_indexes = _best_signal_indexes(signals, media_items, limit=6)
    citation_count = len(
        {
            _signal_url(signals[index])
            for index in cited_indexes
            if 0 <= index < len(signals) and _signal_url(signals[index])
        }
    )
    evidence_assessment = _source_evidence_assessment(cited_indexes, signals)
    score = min(0.82, 0.42 + 0.05 * len(cited_indexes) + 0.04 * citation_count)

    return [
        ManagedOpportunity(
            title=hypothesis,
            problem=pain_area,
            target_user=target_user,
            mvp_concept=mvp,
            score=round(score, 2),
            score_rationale=(
                f"Collected {len(media_items)} public items and linked {len(cited_indexes)} signals "
                "against the approved research brief. Treat as source-backed research, not market validation."
            ),
            source_indexes=cited_indexes,
            profile={
                "origin": "approved_research_brief",
                "source_plan": source_plan,
                "constraints": constraints,
                "disqualifying_evidence": disqualifiers,
                "mvp_boundaries": boundaries,
                "user_taste_notes": taste_notes,
                "open_questions": open_questions,
                "evidence_state": "source_collected",
                "media_item_count": len(media_items),
                "citation_count": citation_count,
                **evidence_assessment,
            },
        )
    ][:max_opportunities]


def _bucket_media(media_items: list[MediaItem]) -> dict[str, list[int]]:
    buckets: dict[str, list[int]] = defaultdict(list)
    for index, item in enumerate(media_items):
        if item.source == "collector_error":
            continue
        buckets[_best_bucket(f"{item.title} {item.summary} {' '.join(item.tags)}")].append(index)
    return dict(buckets)


def _best_signal_indexes(
    signals: list[ManagedSignal | dict[str, Any]],
    media_items: list[MediaItem],
    limit: int,
) -> list[int]:
    return _ranked_signal_indexes(list(range(len(signals))), signals, media_items)[:limit]


def _ranked_signal_indexes(
    indexes: list[int],
    signals: list[ManagedSignal | dict[str, Any]],
    media_items: list[MediaItem],
) -> list[int]:
    scored: list[tuple[float, int]] = []
    for index in indexes:
        signal = signals[index]
        signal_url = _signal_url(signal)
        media_score = 0.0
        for item in media_items:
            if item.url and signal_url and item.url == signal_url:
                media_score = _media_score(item)
                break
        scored.append((media_score + (0.1 if signal_url else 0.0), index))
    scored.sort(reverse=True)
    return [index for _, index in scored]


def _source_evidence_assessment(
    indexes: list[int],
    signals: list[ManagedSignal | dict[str, Any]],
) -> dict[str, Any]:
    valid_indexes = [
        index
        for index in indexes
        if isinstance(index, int) and 0 <= index < len(signals)
    ]
    linked_count = len(set(valid_indexes))
    cited_count = len({_signal_url(signals[index]) for index in valid_indexes if _signal_url(signals[index])})
    if linked_count < 2:
        reason = "Needs at least two linked public-source signals before build approval."
        sufficient = False
    elif cited_count < 1:
        reason = "Needs at least one cited source URL before build approval."
        sufficient = False
    else:
        reason = "Has enough linked and cited public-source evidence for build review."
        sufficient = True
    return {
        "linked_signal_count": linked_count,
        "cited_signal_count": cited_count,
        "evidence_sufficient_for_build": sufficient,
        "evidence_sufficiency_reason": reason,
    }


def _signal_url(signal: ManagedSignal | dict[str, Any]) -> str | None:
    if isinstance(signal, dict):
        return signal.get("url") or signal.get("source_url") or None
    return signal.url


def _signal_text(signal: ManagedSignal | dict[str, Any], key: str) -> str:
    if isinstance(signal, dict):
        return str(signal.get(key) or "")
    return str(getattr(signal, key, "") or "")


def _signal_tags(signal: ManagedSignal | dict[str, Any]) -> list[str]:
    tags = signal.get("tags", []) if isinstance(signal, dict) else signal.tags
    return [str(item) for item in tags if item]


def _media_score(item: MediaItem) -> float:
    metadata = item.metadata or {}
    score = 0.0
    for key in ("score", "points", "comments", "num_comments"):
        value = metadata.get(key)
        if isinstance(value, (int, float)):
            score += min(0.3, float(value) / 100.0)
    if item.captured_text or item.summary:
        score += 0.2
    return score


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


def _mvp_concept(bucket: str) -> str:
    return {
        "deploy": "A setup checker that turns repository state into a deploy-readiness plan and smoke checklist.",
        "eval": "A lightweight eval runner that records expected agent behavior and reruns it before release.",
        "observe": "A trace review surface that groups failed or surprising LLM calls by root-cause theme.",
        "cost": "A budget guardrail that previews and caps expensive agent actions before they run.",
        "security": "A permission review layer that makes planned agent tool calls explicit before approval.",
        "rag": "A retrieval QA harness that samples answers against cited source snippets.",
        "integration": "A schema-aware integration helper that validates tool/API contracts before an agent uses them.",
    }.get(bucket, "A narrow workflow helper for the repeated developer pain found in public signals.")
