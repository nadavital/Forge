from forge_managed_research.local_synthesis import (
    synthesize_brief_opportunities,
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
    assert opportunities[0].profile["linked_signal_count"] == 1
    assert opportunities[0].profile["evidence_sufficient_for_build"] is False


def test_brief_synthesis_accepts_dict_signals_from_stored_payloads():
    brief = {
        "hypothesis": "AI idea coach",
        "pain_area": "Founders struggle to pick credible product ideas",
        "target_users": ["solo founders"],
        "constraints": ["No paid APIs"],
        "mvp_boundaries": ["A conversational brief compiler"],
        "source_plan": ["public founder forums"],
        "disqualifying_evidence": ["Existing free tools solve this fully"],
        "user_taste_notes": ["Calm product partner, not an agent control room"],
        "open_questions": ["Which founder segment feels the pain weekly?"],
    }
    signals = [
        {
            "source": "manual",
            "source_url": "https://example.com/pain",
            "title": "founder pain",
            "body": "Solo founders struggle to prioritize credible product ideas.",
            "tags": ["idea"],
        }
    ]

    opportunities = synthesize_brief_opportunities(brief, [], signals, max_opportunities=2)

    assert len(opportunities) == 1
    assert opportunities[0].title == "AI idea coach"
    assert opportunities[0].profile["origin"] == "approved_research_brief"
    assert opportunities[0].profile["citation_count"] == 1
    assert opportunities[0].profile["linked_signal_count"] == 1
    assert opportunities[0].profile["evidence_sufficient_for_build"] is False
    assert "two linked" in opportunities[0].profile["evidence_sufficiency_reason"]
    assert opportunities[0].profile["constraints"] == ["No paid APIs"]
    assert opportunities[0].profile["mvp_boundaries"] == ["A conversational brief compiler"]
    assert opportunities[0].profile["user_taste_notes"] == ["Calm product partner, not an agent control room"]
    assert opportunities[0].profile["open_questions"] == ["Which founder segment feels the pain weekly?"]


def test_brief_synthesis_marks_multi_source_cited_evidence_build_ready():
    brief = {
        "hypothesis": "AI idea coach",
        "pain_area": "Founders struggle to pick credible product ideas",
        "target_users": ["solo founders"],
        "mvp_boundaries": ["A conversational brief compiler"],
    }
    signals = [
        {
            "source": "hacker_news",
            "url": "https://example.com/pain-1",
            "title": "founder pain",
            "body": "Solo founders struggle to prioritize credible product ideas.",
            "tags": ["idea"],
        },
        {
            "source": "stack_exchange",
            "url": "https://example.com/pain-2",
            "title": "validation pain",
            "body": "It is hard to validate an idea before building.",
            "tags": ["idea"],
        },
    ]

    opportunities = synthesize_brief_opportunities(brief, [], signals, max_opportunities=2)

    assert opportunities[0].profile["linked_signal_count"] == 2
    assert opportunities[0].profile["cited_signal_count"] == 2
    assert opportunities[0].profile["evidence_sufficient_for_build"] is True
