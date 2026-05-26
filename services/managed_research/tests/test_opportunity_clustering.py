from pathlib import Path

from forge_managed_research.clustering import cluster_opportunities
from forge_managed_research.evaluate import _evaluation_from_fixture
from forge_managed_research.schemas import OpportunityRecord, SignalRecord

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def test_cluster_opportunities_groups_duplicate_cost_ideas():
    signals = {
        "sig-1": SignalRecord(
            id="sig-1",
            source="github",
            title="Need max budget guardrails",
            body="Runaway token spend needs budget controls.",
            url="https://example.com/cost",
            tags=["cost"],
        )
    }
    opportunities = [
        OpportunityRecord(
            id="opp-1",
            title="LLM Cost Control workflow helper",
            problem="Developers have repeated pain with LLM cost control.",
            target_user="AI developers",
            mvp_concept="Budget guardrail proxy that stops runaway agent calls.",
            score=1.0,
            score_rationale="Detected public signals.",
            evidence_signal_ids=["sig-1"],
            evidence_count=1,
        ),
        OpportunityRecord(
            id="opp-2",
            title="LoopShield",
            problem="Autonomous agents can enter runaway loops and consume spend.",
            target_user="AI developers",
            mvp_concept="Middleware that caps token cost and suspends loops.",
            score=0.95,
            score_rationale="Managed research found related pain.",
            evidence_signal_ids=["sig-1"],
            evidence_count=1,
        ),
    ]

    clusters = cluster_opportunities(opportunities, signals, max_clusters=3)

    assert len(clusters) == 1
    assert clusters[0].canonical_title == "Agent Cost And Runaway-Loop Guardrails"
    assert clusters[0].merged_opportunity_ids == ["opp-1", "opp-2"]
    assert clusters[0].evidence[0].id == "sig-1"


def test_bull_bear_fixture_parses_synthesis():
    cluster = cluster_opportunities(
        [
            OpportunityRecord(
                id="opp-1",
                title="LLM Cost Control workflow helper",
                problem="Developers have repeated pain with LLM cost control.",
                target_user="AI developers",
                mvp_concept="Budget guardrail proxy that stops runaway agent calls.",
                score=1.0,
                score_rationale="Detected public signals.",
                evidence_signal_ids=[],
                evidence_count=0,
            )
        ],
        {},
        max_clusters=1,
    )[0]
    raw_text = (FIXTURES_DIR / "bull_bear_output.md").read_text()

    result = _evaluation_from_fixture(cluster, raw_text)

    assert result.decision["recommendation"] == "prototype"
    assert result.synthesis["builder_readiness"] == "ready"
    assert "builder_system_prompt" in result.synthesis
