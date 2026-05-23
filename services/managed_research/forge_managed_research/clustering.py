"""Opportunity clustering for Forge evaluation gates."""

from __future__ import annotations

import re
from collections import defaultdict

from .local_synthesis import PAIN_TERMS
from .schemas import OpportunityCluster, OpportunityRecord, SignalRecord


STOPWORDS = {
    "a",
    "an",
    "and",
    "for",
    "in",
    "of",
    "the",
    "to",
    "with",
    "workflow",
    "helper",
}

BUCKET_LABELS = {
    "deploy": "AI agent deployment",
    "eval": "AI agent evaluation",
    "observe": "LLM observability and debugging",
    "cost": "agent cost and runaway-loop guardrails",
    "security": "agent security and permissions",
    "rag": "production RAG reliability",
    "integration": "agent tool integration",
}


def cluster_opportunities(
    opportunities: list[OpportunityRecord],
    signals_by_id: dict[str, SignalRecord],
    max_clusters: int,
) -> list[OpportunityCluster]:
    buckets: dict[str, list[OpportunityRecord]] = defaultdict(list)
    for opportunity in opportunities:
        buckets[_cluster_key(opportunity)].append(opportunity)

    clusters = [
        _build_cluster(key, grouped, signals_by_id)
        for key, grouped in buckets.items()
        if grouped
    ]
    clusters.sort(key=lambda item: (item.score, len(item.evidence_signal_ids)), reverse=True)
    return clusters[:max_clusters]


def _build_cluster(
    key: str,
    opportunities: list[OpportunityRecord],
    signals_by_id: dict[str, SignalRecord],
) -> OpportunityCluster:
    ranked = sorted(
        opportunities,
        key=lambda item: (item.score, item.evidence_count, len(item.problem)),
        reverse=True,
    )
    representative = ranked[0]
    evidence_signal_ids = _unique(
        signal_id
        for opportunity in ranked
        for signal_id in opportunity.evidence_signal_ids
    )
    evidence = [
        signals_by_id[signal_id]
        for signal_id in evidence_signal_ids
        if signal_id in signals_by_id
    ][:12]
    variants = _unique(opportunity.title for opportunity in ranked)
    label = BUCKET_LABELS.get(key, representative.title)
    score = min(
        1.0,
        round(
            max(opportunity.score for opportunity in ranked)
            + 0.03 * max(0, len(ranked) - 1)
            + 0.01 * min(10, len(evidence_signal_ids)),
            2,
        ),
    )
    return OpportunityCluster(
        canonical_title=label.title(),
        problem=representative.problem,
        target_user=representative.target_user,
        mvp_concept=representative.mvp_concept,
        score=score,
        representative_opportunity_id=representative.id,
        merged_opportunity_ids=[opportunity.id for opportunity in ranked],
        evidence_signal_ids=evidence_signal_ids,
        variants=variants,
        tags=[key, "opportunity_cluster"],
        why_clustered=(
            f"Grouped {len(ranked)} opportunities by shared {label} language, "
            f"MVP shape, and linked evidence."
        ),
        evidence=evidence,
    )


def _cluster_key(opportunity: OpportunityRecord) -> str:
    text = " ".join(
        [
            opportunity.title,
            opportunity.problem,
            opportunity.mvp_concept,
            " ".join(str(tag) for tag in opportunity.profile.get("tags", [])),
        ]
    ).lower()
    term_scores: dict[str, int] = {}
    for bucket, terms in PAIN_TERMS.items():
        score = sum(1 for term in terms if term in text)
        if score:
            term_scores[bucket] = score
    if term_scores:
        return sorted(term_scores.items(), key=lambda item: item[1], reverse=True)[0][0]
    tokens = [token for token in re.findall(r"[a-z0-9]+", text) if token not in STOPWORDS]
    return "-".join(tokens[:3]) or "general"


def _unique(values) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
