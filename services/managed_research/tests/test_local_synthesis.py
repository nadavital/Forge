from forge_managed_research.local_synthesis import (
    synthesize_opportunities,
    synthesize_seed_topics,
    synthesize_signals,
)
from forge_managed_research.schemas import MediaItem


def test_local_synthesis_creates_topics_signals_and_opportunities():
    media_items = [
        MediaItem(
            source="hacker_news",
            title="Agent deployment is painful",
            summary="Production deployment and hosting for AI agents is hard.",
            url="https://example.com/deploy",
            tags=["deployment"],
        ),
        MediaItem(
            source="github",
            title="Need max budget guardrails",
            summary="Runaway token spend needs cost and budget controls.",
            url="https://example.com/cost",
            tags=["cost"],
        ),
    ]

    seed_topics = synthesize_seed_topics(media_items, max_topics=3)
    signals = synthesize_signals(media_items)
    opportunities = synthesize_opportunities(media_items, signals, max_opportunities=3)

    assert len(seed_topics) == 2
    assert len(signals) == 2
    assert len(opportunities) == 2
    assert signals[0].metadata["pipeline"] == "source_collect"
    assert opportunities[0].source_indexes
