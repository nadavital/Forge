"""CLI for managed-agent powered Forge ingestion."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .env import load_repo_env
from .extract import extract_json_object, extract_json_payload
from .interactions import ManagedAgentClient
from .schemas import ManagedResearchResult, TrendResearchPipelineResult
from .supabase import SupabaseWriter


def main() -> None:
    parser = argparse.ArgumentParser(description="Run managed-agent Forge ingestion.")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--pipeline", choices=["single", "trend-research"], default="single")
    parser.add_argument("--agent", choices=["antigravity", "deep-research"], default="antigravity")
    parser.add_argument("--trend-agent", choices=["antigravity"], default="antigravity")
    parser.add_argument("--research-agent", choices=["antigravity", "deep-research"], default="antigravity")
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true", help="Print preview records in command output.")
    parser.add_argument("--input-file", help="Use existing managed-agent output instead of calling Gemini.")
    parser.add_argument("--trend-input-file", help="Use existing TrendScout output for trend-research.")
    parser.add_argument("--research-input-file", help="Use existing ResearchAnalyst output for trend-research.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[3]
    load_repo_env(repo_root)
    agents_dir = repo_root / ".agents"

    if args.pipeline == "trend-research":
        summary = run_trend_research(args, agents_dir)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.input_file and (args.trend_input_file or args.research_input_file):
        raise SystemExit("--input-file cannot be combined with trend-research input files.")

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
    }
    if args.verbose:
        summary["preview"] = {
            "signals": [signal.to_supabase_row() for signal in result.signals[:3]],
            "opportunities": [
                opportunity.to_supabase_row(pipeline_run_id=None)
                for opportunity in result.opportunities[:3]
            ],
        }

    if args.save:
        summary["supabase"] = SupabaseWriter().save(result)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."

    print(json.dumps(summary, indent=2, sort_keys=True))


def run_trend_research(args: argparse.Namespace, agents_dir: Path) -> dict[str, object]:
    client: ManagedAgentClient | None = None

    if args.trend_input_file:
        trend_raw_text = Path(args.trend_input_file).read_text()
    else:
        print("trend_research: running TrendScout", file=sys.stderr)
        client = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY"))
        trend_raw_text = client.run_trend_scout(args.topic, agents_dir=agents_dir)
        print("trend_research: TrendScout completed", file=sys.stderr)

    trend_payload = extract_json_object(trend_raw_text, required_any=("media_items",))
    trend_payload.setdefault("media_items", [])
    trend_result = TrendResearchPipelineResult.from_payloads(
        topic=args.topic,
        trend_payload=trend_payload,
        trend_raw_text=trend_raw_text,
        trend_agent=args.trend_agent,
        research_payload={"signals": [], "opportunities": [], "research_findings": []},
        research_raw_text="",
        research_agent=args.research_agent,
    ).trend

    if args.research_input_file:
        research_raw_text = Path(args.research_input_file).read_text()
    else:
        if client is None:
            client = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY"))
        print("trend_research: running ResearchAnalyst", file=sys.stderr)
        research_raw_text = client.run_research_analyst(
            args.topic,
            media_items=trend_result.media_items,
            agents_dir=agents_dir,
            agent=args.research_agent,
        )
        print("trend_research: ResearchAnalyst completed", file=sys.stderr)

    research_payload = extract_json_payload(research_raw_text)
    raw_research_payload = extract_json_object(
        research_raw_text,
        required_any=("research_findings", "signals", "opportunities"),
    )
    if "research_findings" in raw_research_payload:
        research_payload["research_findings"] = raw_research_payload["research_findings"]

    result = TrendResearchPipelineResult.from_payloads(
        topic=args.topic,
        trend_payload=trend_payload,
        trend_raw_text=trend_raw_text,
        trend_agent=args.trend_agent,
        research_payload=research_payload,
        research_raw_text=research_raw_text,
        research_agent=args.research_agent,
    )

    summary: dict[str, object] = {
        "pipeline": "trend_research",
        "topic": args.topic,
        "trend_agent": args.trend_agent,
        "research_agent": args.research_agent,
        "media_items": len(result.trend.media_items),
        "research_findings": len(result.research_findings),
        "signals": len(result.research.signals),
        "opportunities": len(result.research.opportunities),
        "raw_output_chars": {
            "trend": len(trend_raw_text),
            "research": len(research_raw_text),
        },
    }
    if args.verbose:
        summary["preview"] = {
            "media_items": [
                item.to_metadata()
                for item in result.trend.media_items[:3]
            ],
            "research_findings": [
                finding.to_metadata()
                for finding in result.research_findings[:3]
            ],
            "signals": [
                signal.to_supabase_row()
                for signal in result.research.signals[:3]
            ],
        }

    if args.save:
        summary["supabase"] = SupabaseWriter().save_trend_research(result)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."

    return summary


if __name__ == "__main__":
    main()
