"""CLI for managed-agent powered Forge ingestion."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .collectors import CollectorConfig, collect_public_media, github_token_from_env
from .env import load_repo_env
from .extract import extract_json_object, extract_json_payload
from .interactions import ManagedAgentClient
from .local_synthesis import (
    synthesize_opportunities,
    synthesize_seed_topics,
    synthesize_signals,
)
from .schemas import (
    ManagedResearchResult,
    SeedDiscoveryResult,
    SourceCollectionResult,
    TrendResearchPipelineResult,
)
from .supabase import SupabaseWriter


def main() -> None:
    parser = argparse.ArgumentParser(description="Run managed-agent Forge ingestion.")
    parser.add_argument("--topic")
    parser.add_argument(
        "--pipeline",
        choices=[
            "single",
            "trend-research",
            "seed-topics",
            "auto-trend-research",
            "source-collect",
        ],
        default="single",
    )
    parser.add_argument("--agent", choices=["antigravity", "deep-research"], default="antigravity")
    parser.add_argument("--trend-agent", choices=["antigravity"], default="antigravity")
    parser.add_argument("--research-agent", choices=["antigravity", "deep-research"], default="antigravity")
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true", help="Print preview records in command output.")
    parser.add_argument("--input-file", help="Use existing managed-agent output instead of calling Gemini.")
    parser.add_argument("--trend-input-file", help="Use existing TrendScout output for trend-research.")
    parser.add_argument("--research-input-file", help="Use existing ResearchAnalyst output for trend-research.")
    parser.add_argument("--seed-input-file", help="Use existing TopicSeeder output for seed-topics or auto-trend-research.")
    parser.add_argument("--max-topics", type=int, default=3)
    parser.add_argument("--limit-per-source", type=int, default=10)
    parser.add_argument("--max-opportunities", type=int, default=5)
    parser.add_argument("--project-id", help="Attach saved pipeline records to a Forge project UUID.")
    parser.add_argument(
        "--subreddits",
        default="",
        help="Comma-separated subreddits used to scope Reddit source collection.",
    )
    parser.add_argument(
        "--stack-exchange-sites",
        default="",
        help="Comma-separated Stack Exchange API site ids used for source collection, defaulting to stackoverflow.",
    )
    parser.add_argument(
        "--trigger",
        choices=["remote", "schedule", "manual", "managed_agent"],
        default="remote",
        help="pipeline_runs trigger value used when saving source-collect output.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[3]
    load_repo_env(repo_root)
    agents_dir = repo_root / ".agents"

    if args.pipeline == "source-collect":
        summary = run_source_collect(args)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.pipeline == "seed-topics":
        summary = run_seed_topics(args, agents_dir)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.pipeline == "auto-trend-research":
        summary = run_auto_trend_research(args, agents_dir)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.pipeline == "trend-research":
        summary = run_trend_research(args, agents_dir)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.input_file and (args.trend_input_file or args.research_input_file):
        raise SystemExit("--input-file cannot be combined with trend-research input files.")
    if not args.topic:
        raise SystemExit("--topic is required for single managed research.")

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
        summary["supabase"] = SupabaseWriter().save(result, project_id=args.project_id)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."

    print(json.dumps(summary, indent=2, sort_keys=True))


def run_trend_research(args: argparse.Namespace, agents_dir: Path) -> dict[str, object]:
    if not args.topic:
        raise SystemExit("--topic is required for trend-research.")
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
        summary["supabase"] = SupabaseWriter().save_trend_research(result, project_id=args.project_id)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."

    return summary


def run_seed_topics(args: argparse.Namespace, agents_dir: Path) -> dict[str, object]:
    theme = args.topic or "developer tool and AI product pain from current public technical communities"
    if args.seed_input_file:
        raw_text = Path(args.seed_input_file).read_text()
    else:
        print("seed_topics: running TopicSeeder", file=sys.stderr)
        client = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY"))
        raw_text = client.run_topic_seeder(
            theme,
            agents_dir=agents_dir,
            max_topics=args.max_topics,
        )
        print("seed_topics: TopicSeeder completed", file=sys.stderr)

    payload = extract_json_object(raw_text, required_any=("seed_topics",))
    payload.setdefault("seed_topics", [])
    result = SeedDiscoveryResult.from_payload(
        payload,
        raw_text=raw_text,
        agent="antigravity",
        theme=theme,
    )
    seed_topics = sorted(result.seed_topics, key=lambda topic: topic.score, reverse=True)
    if args.max_topics > 0:
        seed_topics = seed_topics[: args.max_topics]
        result.seed_topics = seed_topics

    summary: dict[str, object] = {
        "pipeline": "seed_topics",
        "theme": theme,
        "agent": result.agent,
        "seed_topics": len(result.seed_topics),
        "raw_output_chars": len(raw_text),
        "topics": [
            {
                "topic": topic.topic,
                "title": topic.title,
                "score": topic.score,
                "tags": topic.tags,
            }
            for topic in result.seed_topics
        ],
    }
    if args.verbose:
        summary["preview"] = {
            "seed_topics": [
                topic.to_metadata()
                for topic in result.seed_topics
            ]
        }

    if args.save:
        summary["supabase"] = SupabaseWriter().save_seed_discovery(result, project_id=args.project_id)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."
    return summary


def run_auto_trend_research(args: argparse.Namespace, agents_dir: Path) -> dict[str, object]:
    seed_args = argparse.Namespace(**vars(args))
    seed_args.save = False
    seed_args.dry_run = True
    seed_summary = run_seed_topics(seed_args, agents_dir)
    seed_topics = [
        item["topic"]
        for item in seed_summary.get("topics", [])
        if isinstance(item, dict) and item.get("topic")
    ]

    runs: list[dict[str, object]] = []
    for topic in seed_topics[: args.max_topics]:
        trend_args = argparse.Namespace(**vars(args))
        trend_args.topic = topic
        trend_args.trend_input_file = None
        trend_args.research_input_file = None
        trend_args.pipeline = "trend-research"
        try:
            runs.append(run_trend_research(trend_args, agents_dir))
        except Exception as exc:  # pragma: no cover - exercised by live managed agents
            runs.append(
                {
                    "topic": topic,
                    "status": "failed",
                    "error": str(exc),
                }
            )
            break

    return {
        "pipeline": "auto_trend_research",
        "seed_summary": seed_summary,
        "runs": runs,
    }


def run_source_collect(args: argparse.Namespace) -> dict[str, object]:
    query = args.topic or "AI agents developer tools production pain"
    media_items = collect_public_media(
        CollectorConfig(
            query=query,
            limit_per_source=max(1, args.limit_per_source),
            github_token=github_token_from_env(),
            reddit_subreddits=_csv(args.subreddits or os.environ.get("FORGE_REDDIT_SUBREDDITS", "")),
            stack_exchange_sites=_csv(
                args.stack_exchange_sites or os.environ.get("FORGE_STACK_EXCHANGE_SITES", "stackoverflow")
            ),
        )
    )
    seed_topics = synthesize_seed_topics(media_items, max_topics=max(1, args.max_topics))
    signals = synthesize_signals(media_items)
    opportunities = synthesize_opportunities(
        media_items,
        signals,
        max_opportunities=max(1, args.max_opportunities),
    )
    result = SourceCollectionResult(
        query=query,
        media_items=media_items,
        seed_topics=seed_topics,
        signals=signals,
        opportunities=opportunities,
    )

    summary: dict[str, object] = {
        "pipeline": "source_collect",
        "query": query,
        "media_items": len(media_items),
        "seed_topics": len(seed_topics),
        "signals": len(signals),
        "opportunities": len(opportunities),
        "sources": _count_sources(media_items),
        "topics": [
            {
                "topic": topic.topic,
                "title": topic.title,
                "score": topic.score,
                "tags": topic.tags,
            }
            for topic in seed_topics
        ],
    }
    if args.verbose:
        summary["preview"] = {
            "media_items": [
                item.to_metadata()
                for item in media_items[:5]
            ],
            "signals": [
                signal.to_supabase_row()
                for signal in signals[:5]
            ],
            "opportunities": [
                opportunity.to_supabase_row(pipeline_run_id=None)
                for opportunity in opportunities[:5]
            ],
        }

    if args.save:
        summary["supabase"] = SupabaseWriter().save_source_collection(
            result,
            project_id=args.project_id,
            trigger=args.trigger,
        )
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write to Supabase."
    return summary


def _count_sources(media_items: list[object]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in media_items:
        source = getattr(item, "source", "unknown")
        counts[source] = counts.get(source, 0) + 1
    return counts


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


if __name__ == "__main__":
    main()
