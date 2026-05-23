"""Deterministic pain point extraction used by tools and tests."""

from __future__ import annotations

import re
from collections import Counter

from .models import PainPoint, Signal, signal_key


PAIN_TERMS = {
    "annoying",
    "blocked",
    "broken",
    "bug",
    "can't",
    "complex",
    "confusing",
    "difficult",
    "expensive",
    "failed",
    "hard",
    "issue",
    "limitation",
    "manual",
    "missing",
    "pain",
    "problem",
    "slow",
    "tedious",
    "unreliable",
}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z][a-zA-Z0-9_+-]{2,}", text.lower())


def _title_from_signal(signal: Signal, pain_terms: list[str]) -> str:
    term = pain_terms[0] if pain_terms else "workflow"
    base = signal.title.strip()[:90] or "Developer workflow pain"
    return f"Reduce {term} around {base}"


def identify_from_signals(signals: list[Signal], max_points: int = 10) -> list[PainPoint]:
    pain_points: list[PainPoint] = []

    for signal in signals:
        text = f"{signal.title}\n{signal.body}"
        tokens = _tokens(text)
        counts = Counter(tokens)
        found_terms = [term for term in PAIN_TERMS if term in counts or term in text.lower()]
        if not found_terms:
            continue

        metadata_score = 0.0
        if signal.source == "github_repo":
            metadata_score += min(float(signal.metadata.get("open_issues") or 0) / 1000, 0.2)
            metadata_score += min(float(signal.metadata.get("stars") or 0) / 10000, 0.2)
        if signal.source in {"hacker_news", "reddit"}:
            metadata_score += min(float(signal.metadata.get("num_comments") or 0) / 200, 0.2)

        score = min(1.0, 0.25 + len(found_terms) * 0.08 + metadata_score)
        top_keywords = [token for token, _ in counts.most_common(8)]
        pain_points.append(
            PainPoint(
                title=_title_from_signal(signal, found_terms),
                problem=(signal.body or signal.title)[:500],
                target_user="Developers or technical teams affected by this workflow",
                mvp_concept="Build a small workflow tool that removes the repeated friction described in the source evidence.",
                score=round(score, 3),
                score_rationale=(
                    f"Matched pain terms {sorted(found_terms)} in {signal.source}; "
                    f"source metadata added {metadata_score:.2f}."
                ),
                source_signal_keys=[signal_key(signal)],
                profile={
                    "source": signal.source,
                    "keywords": top_keywords,
                    "pain_terms": sorted(found_terms),
                    "evidence_url": signal.url,
                },
            )
        )

    return sorted(pain_points, key=lambda item: item.score, reverse=True)[:max_points]

