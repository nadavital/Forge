"""CLI for managed-agent powered Forge ingestion."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .extract import extract_json_payload
from .interactions import ManagedAgentClient
from .schemas import ManagedResearchResult
from .supabase import SupabaseWriter


def main() -> None:
    parser = argparse.ArgumentParser(description="Run managed-agent Forge ingestion.")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--agent", choices=["antigravity", "deep-research"], default="antigravity")
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--input-file", help="Use existing managed-agent output instead of calling Gemini.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[3]
    agents_dir = repo_root / ".agents"

    if args.input_file:
        raw_text = Path(args.input_file).read_text()
    else:
        client = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY"))
        if args.agent == "deep-research":
            raw_text = client.run_deep_research(args.topic)
        else:
            raw_text = client.run_antigravity(args.topic, agents_dir=agents_dir)

    payload = extract_json_payload(raw_text)
    result = ManagedResearchResult.from_payload(payload, raw_text=raw_text, agent=args.agent)

    summary = {
        "agent": args.agent,
        "signals": len(result.signals),
        "opportunities": len(result.opportunities),
        "raw_output_chars": len(raw_text),
        "preview": {
            "signals": [signal.to_supabase_row() for signal in result.signals[:3]],
            "opportunities": [
                opportunity.to_supabase_row(pipeline_run_id=None)
                for opportunity in result.opportunities[:3]
            ],
        },
    }

    if args.save:
        summary["supabase"] = SupabaseWriter().save(result)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."

    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

