"""Minimal stdlib test runner for environments without pytest."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_extract import (  # noqa: E402
    test_extract_json_payload_from_fenced_block,
    test_extract_json_payload_returns_empty_contract_when_missing,
)


def main() -> None:
    test_extract_json_payload_from_fenced_block()
    test_extract_json_payload_returns_empty_contract_when_missing()
    print("stdlib tests passed")


if __name__ == "__main__":
    main()

