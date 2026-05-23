from forge_managed_research.extract import extract_json_object, extract_json_payload
from forge_managed_research.schemas import TrendResearchPipelineResult


def test_trend_research_pipeline_result_from_payloads():
    trend_raw = """
```json
{"media_items":[{"source":"forum","title":"Loop pain","summary":"Runaway loop","tags":["agents"]}]}
```
"""
    research_raw = """
```json
{"research_findings":[{"title":"Guardrails","summary":"Teams need limits","media_item_indexes":[0]}],"signals":[{"source":"research","title":"Budget pain","body":"Costs spike"}],"opportunities":[{"title":"Budget guard","problem":"Cost spikes","target_user":"AI engineers","mvp_concept":"Proxy","score":0.8,"score_rationale":"Clear pain","source_indexes":[0]}]}
```
"""
    trend_payload = extract_json_object(trend_raw, required_any=("media_items",))
    research_payload = extract_json_payload(research_raw)
    research_payload["research_findings"] = extract_json_object(
        research_raw,
        required_any=("research_findings",),
    )["research_findings"]

    result = TrendResearchPipelineResult.from_payloads(
        topic="agent deployment pain",
        trend_payload=trend_payload,
        trend_raw_text=trend_raw,
        trend_agent="antigravity",
        research_payload=research_payload,
        research_raw_text=research_raw,
        research_agent="antigravity",
    )

    assert len(result.trend.media_items) == 1
    assert len(result.research_findings) == 1
    assert len(result.research.signals) == 1
    assert len(result.research.opportunities) == 1
    assert result.research_findings[0].media_item_indexes == [0]
