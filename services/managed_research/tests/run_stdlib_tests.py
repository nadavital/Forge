"""Minimal stdlib test runner for environments without pytest."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_extract import (  # noqa: E402
    test_extract_json_payload_from_fenced_block,
    test_extract_json_payload_returns_empty_contract_when_missing,
)
from test_local_synthesis import test_local_synthesis_creates_topics_signals_and_opportunities  # noqa: E402
from test_trend_research import (  # noqa: E402
    test_seed_discovery_result_from_payload,
    test_trend_research_pipeline_result_from_payloads,
)
from forge_managed_research.env import load_env_file  # noqa: E402


def main() -> None:
    test_extract_json_payload_from_fenced_block()
    test_extract_json_payload_returns_empty_contract_when_missing()
    test_local_synthesis_creates_topics_signals_and_opportunities()
    test_trend_research_pipeline_result_from_payloads()
    test_seed_discovery_result_from_payload()
    load_env_file(Path("/tmp/forge-managed-research-missing.env"))
    print("stdlib tests passed")


if __name__ == "__main__":
    main()
