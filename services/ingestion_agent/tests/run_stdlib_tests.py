"""Minimal stdlib test runner for environments without pytest."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_pain_points import (
    test_identify_from_signals_extracts_pain_point,
    test_identify_from_signals_skips_non_pain_signal,
)
from test_tools import test_save_ingestion_result_writes_expected_tables


def main() -> None:
    test_identify_from_signals_extracts_pain_point()
    test_identify_from_signals_skips_non_pain_signal()
    test_save_ingestion_result_writes_expected_tables()
    print("stdlib tests passed")


if __name__ == "__main__":
    main()
