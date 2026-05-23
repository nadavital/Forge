from forge_managed_research.extract import extract_json_payload
from forge_managed_research.schemas import ManagedResearchResult


def test_extract_json_payload_from_fenced_block():
    text = """
Report text.

```json
{"signals":[{"source":"web","title":"Pain","body":"Hard setup"}],"opportunities":[{"title":"Setup helper","problem":"Hard setup","target_user":"Developers","mvp_concept":"CLI","score":0.7,"score_rationale":"Repeated pain","source_indexes":[0]}]}
```
"""

    payload = extract_json_payload(text)
    result = ManagedResearchResult.from_payload(payload, raw_text=text, agent="test")

    assert len(result.signals) == 1
    assert len(result.opportunities) == 1
    assert result.opportunities[0].score == 0.7


def test_extract_json_payload_returns_empty_contract_when_missing():
    payload = extract_json_payload("No structured output")

    assert payload == {"signals": [], "opportunities": []}

