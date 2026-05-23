"""CLI for opportunity clustering and Bull/Bear evaluation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from .clustering import cluster_opportunities
from .env import load_repo_env
from .extract import extract_json_object
from .interactions import ManagedAgentClient
from .schemas import BullBearEvaluation, OpportunityCluster
from .supabase import SupabaseWriter


def main() -> None:
    parser = argparse.ArgumentParser(description="Cluster and evaluate Forge opportunities.")
    parser.add_argument("--mode", choices=["cluster", "bull-bear"], default="cluster")
    parser.add_argument("--max-opportunities", type=int, default=100)
    parser.add_argument("--max-clusters", type=int, default=5)
    parser.add_argument("--cluster-index", type=int, default=0)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--evaluation-input-file",
        help="Use fixture JSON/Markdown with bull, bear, decision, and synthesis instead of live managed agents.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[3]
    load_repo_env(repo_root)
    agents_dir = repo_root / ".agents"
    writer = SupabaseWriter()
    opportunities, signals_by_id = writer.fetch_opportunity_records(limit=args.max_opportunities)
    clusters = cluster_opportunities(
        opportunities,
        signals_by_id,
        max_clusters=max(1, args.max_clusters),
    )

    if args.mode == "cluster":
        summary: dict[str, Any] = {
            "mode": "cluster",
            "opportunities_read": len(opportunities),
            "clusters": [_cluster_summary(cluster) for cluster in clusters],
        }
        if args.save:
            summary["supabase"] = writer.save_opportunity_clusters(clusters)
        elif not args.dry_run:
            summary["note"] = "Dry-run by default. Pass --save to write cluster metadata."
        if args.verbose:
            summary["cluster_packets"] = [cluster.to_metadata() for cluster in clusters]
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if not clusters:
        raise SystemExit("No opportunity clusters available for Bull/Bear evaluation.")
    if args.cluster_index < 0 or args.cluster_index >= len(clusters):
        raise SystemExit(f"--cluster-index must be between 0 and {len(clusters) - 1}.")
    cluster = clusters[args.cluster_index]

    if args.evaluation_input_file:
        evaluation = _evaluation_from_fixture(cluster, Path(args.evaluation_input_file).read_text())
    else:
        evaluation = _run_managed_evaluation(cluster, agents_dir)

    summary = {
        "mode": "bull-bear",
        "cluster": _cluster_summary(cluster),
        "bull": _short_eval(evaluation.bull),
        "bear": _short_eval(evaluation.bear),
        "decision": _short_eval(evaluation.decision),
        "synthesis": _short_eval(evaluation.synthesis),
    }
    if args.verbose:
        summary["evaluation"] = {
            "bull": evaluation.bull,
            "bear": evaluation.bear,
            "decision": evaluation.decision,
            "synthesis": evaluation.synthesis,
        }
    if args.save:
        summary["supabase"] = writer.save_bull_bear_evaluation(evaluation)
    elif not args.dry_run:
        summary["note"] = "Dry-run by default. Pass --save to write Bull/Bear evaluations."
    print(json.dumps(summary, indent=2, sort_keys=True))


def _run_managed_evaluation(cluster: OpportunityCluster, agents_dir: Path) -> BullBearEvaluation:
    client = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY"))

    print("bull_bear: running BullAgent", file=sys.stderr)
    bull_raw = client.run_bull_agent(cluster, agents_dir=agents_dir)
    bull = extract_json_object(bull_raw, required_any=("position", "summary", "why_real_pain"))
    print("bull_bear: BullAgent completed", file=sys.stderr)

    print("bull_bear: running BearAgent", file=sys.stderr)
    bear_raw = client.run_bear_agent(cluster, agents_dir=agents_dir)
    bear = extract_json_object(bear_raw, required_any=("position", "summary", "missing_evidence"))
    print("bull_bear: BearAgent completed", file=sys.stderr)

    print("bull_bear: running DecisionAgent", file=sys.stderr)
    decision_raw = client.run_decision_agent(cluster, bull=bull, bear=bear, agents_dir=agents_dir)
    decision = extract_json_object(decision_raw, required_any=("recommendation", "summary", "next_action"))
    print("bull_bear: DecisionAgent completed", file=sys.stderr)

    print("bull_bear: running Synthesizer", file=sys.stderr)
    synthesis_raw = client.run_synthesizer_agent(
        cluster,
        bull=bull,
        bear=bear,
        decision=decision,
        agents_dir=agents_dir,
    )
    synthesis = extract_json_object(
        synthesis_raw,
        required_any=("product_pitch", "builder_system_prompt", "builder_readiness"),
    )
    print("bull_bear: Synthesizer completed", file=sys.stderr)

    return BullBearEvaluation(
        cluster=cluster,
        bull=bull,
        bear=bear,
        decision=decision,
        synthesis=synthesis,
        raw_outputs={
            "bull": bull_raw,
            "bear": bear_raw,
            "decision": decision_raw,
            "synthesis": synthesis_raw,
        },
    )


def _evaluation_from_fixture(cluster: OpportunityCluster, raw_text: str) -> BullBearEvaluation:
    payload = extract_json_object(
        raw_text,
        required_any=("bull", "bear", "decision", "synthesis"),
    )
    return BullBearEvaluation(
        cluster=cluster,
        bull=dict(payload.get("bull") or {}),
        bear=dict(payload.get("bear") or {}),
        decision=dict(payload.get("decision") or {}),
        synthesis=dict(payload.get("synthesis") or {}),
        raw_outputs={"fixture": raw_text},
    )


def _cluster_summary(cluster: OpportunityCluster) -> dict[str, Any]:
    return {
        "canonical_title": cluster.canonical_title,
        "score": cluster.score,
        "representative_opportunity_id": cluster.representative_opportunity_id,
        "merged_opportunities": len(cluster.merged_opportunity_ids),
        "evidence_signals": len(cluster.evidence_signal_ids),
        "variants": cluster.variants,
        "mvp_concept": cluster.mvp_concept,
    }


def _short_eval(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": value.get("summary"),
        "recommendation": value.get("recommendation"),
        "product_pitch": value.get("product_pitch"),
        "builder_readiness": value.get("builder_readiness"),
        "confidence": value.get("confidence"),
    }


if __name__ == "__main__":
    main()
