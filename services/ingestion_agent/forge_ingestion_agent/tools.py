"""ADK tool functions for trend and repository ingestion."""

from __future__ import annotations

from .models import PainPoint, Signal
from .pain_points import identify_from_signals
from .sources import fetch_github_repo_trends, fetch_hacker_news_trends, fetch_reddit_trends
from .supabase import SupabaseClient


_LAST_SIGNALS: list[Signal] = []
_LAST_PAIN_POINTS: list[PainPoint] = []


def collect_social_trends(
    keywords: list[str],
    subreddits: list[str] | None = None,
    max_items: int = 25,
) -> dict:
    """Collect public social trend signals from Hacker News and selected Reddit subreddits."""
    global _LAST_SIGNALS
    subreddits = subreddits or []
    hn_signals = fetch_hacker_news_trends(keywords=keywords, max_items=max_items)
    reddit_signals = fetch_reddit_trends(subreddits=subreddits, keywords=keywords, max_items=max_items)
    signals = [*hn_signals, *reddit_signals]
    _LAST_SIGNALS = [*_LAST_SIGNALS, *signals]
    return {
        "count": len(signals),
        "sources": {"hacker_news": len(hn_signals), "reddit": len(reddit_signals)},
        "signals": [signal.to_supabase_row() for signal in signals],
    }


def collect_repo_trends(keywords: list[str], max_items: int = 25) -> dict:
    """Collect GitHub repository trend signals for the supplied keywords."""
    global _LAST_SIGNALS
    signals = fetch_github_repo_trends(keywords=keywords, max_items=max_items)
    _LAST_SIGNALS = [*_LAST_SIGNALS, *signals]
    return {
        "count": len(signals),
        "sources": {"github_repo": len(signals)},
        "signals": [signal.to_supabase_row() for signal in signals],
    }


def identify_pain_points(max_points: int = 10) -> dict:
    """Identify developer pain points from the signals collected in this agent session."""
    global _LAST_PAIN_POINTS
    _LAST_PAIN_POINTS = identify_from_signals(_LAST_SIGNALS, max_points=max_points)
    return {
        "count": len(_LAST_PAIN_POINTS),
        "pain_points": [
            {
                "title": item.title,
                "problem": item.problem,
                "target_user": item.target_user,
                "mvp_concept": item.mvp_concept,
                "score": item.score,
                "score_rationale": item.score_rationale,
                "source_signal_keys": item.source_signal_keys,
                "profile": item.profile,
            }
            for item in _LAST_PAIN_POINTS
        ],
    }


def save_pain_points(trigger: str = "managed_agent") -> dict:
    """Save collected signals and identified pain points to Supabase."""
    if not _LAST_SIGNALS:
        return {"status": "skipped", "reason": "No signals have been collected."}
    if not _LAST_PAIN_POINTS:
        return {"status": "skipped", "reason": "No pain points have been identified."}
    result = SupabaseClient().save_ingestion_result(
        signals=_LAST_SIGNALS,
        pain_points=_LAST_PAIN_POINTS,
        trigger=trigger,
    )
    return {"status": "saved", **result}


def run_ingestion_cycle(
    keywords: list[str],
    subreddits: list[str] | None = None,
    max_items: int = 25,
    max_points: int = 10,
    save: bool = True,
) -> dict:
    """Run collection, pain point extraction, and optional Supabase persistence."""
    global _LAST_SIGNALS, _LAST_PAIN_POINTS
    _LAST_SIGNALS = []
    _LAST_PAIN_POINTS = []
    social = collect_social_trends(keywords=keywords, subreddits=subreddits or [], max_items=max_items)
    repos = collect_repo_trends(keywords=keywords, max_items=max_items)
    pain = identify_pain_points(max_points=max_points)
    result = {
        "social": social["sources"],
        "repos": repos["sources"],
        "signals_collected": social["count"] + repos["count"],
        "pain_points_identified": pain["count"],
        "pain_points": pain["pain_points"],
    }
    if save:
        result["supabase"] = save_pain_points(trigger="managed_agent")
    return result

