from forge_ingestion_agent.models import Signal
from forge_ingestion_agent.pain_points import identify_from_signals


def test_identify_from_signals_extracts_pain_point():
    signals = [
        Signal(
            source="github_repo",
            source_id="123",
            url="https://github.com/example/slow-tool",
            title="example/slow-tool",
            body="Developers say this deployment workflow is slow and confusing.",
            metadata={"open_issues": 45, "stars": 250},
        )
    ]

    pain_points = identify_from_signals(signals)

    assert len(pain_points) == 1
    assert pain_points[0].score > 0
    assert pain_points[0].source_signal_keys == ["github_repo:123"]
    assert "slow" in pain_points[0].profile["pain_terms"]


def test_identify_from_signals_skips_non_pain_signal():
    signals = [
        Signal(
            source="hacker_news",
            source_id="abc",
            title="Show HN: a polished launch",
            body="The project works well and has clear documentation.",
        )
    ]

    assert identify_from_signals(signals) == []

