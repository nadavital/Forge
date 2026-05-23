"""Supabase persistence for managed-agent research output."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .schemas import (
    BullBearEvaluation,
    ManagedResearchResult,
    OpportunityCluster,
    OpportunityRecord,
    SeedDiscoveryResult,
    SignalRecord,
    SourceCollectionResult,
    TrendResearchPipelineResult,
)


class SupabaseWriter:
    def __init__(self, url: str | None = None, service_role_key: str | None = None) -> None:
        self.url = (url or os.environ.get("SUPABASE_URL") or "").rstrip("/")
        self.key = service_role_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
        if not self.url or not self.key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for saving.")

    def insert(self, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        request = Request(
            f"{self.url}/rest/v1/{table}",
            data=json.dumps(rows).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result if isinstance(result, list) else [result]
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase insert failed for {table}: HTTP {exc.code} {body}") from exc

    def select(self, table: str, query: str) -> list[dict[str, Any]]:
        request = Request(
            f"{self.url}/rest/v1/{table}?{query}",
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result if isinstance(result, list) else [result]
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase select failed for {table}: HTTP {exc.code} {body}") from exc

    def update(self, table: str, query: str, values: dict[str, Any]) -> list[dict[str, Any]]:
        request = Request(
            f"{self.url}/rest/v1/{table}?{query}",
            data=json.dumps(values).encode("utf-8"),
            method="PATCH",
            headers={
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result if isinstance(result, list) else [result]
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase update failed for {table}: HTTP {exc.code} {body}") from exc

    def fetch_opportunity_records(self, limit: int = 100) -> tuple[list[OpportunityRecord], dict[str, SignalRecord]]:
        opportunity_rows = self.select(
            "opportunities",
            "select=id,title,problem,target_user,mvp_concept,score,score_rationale,pipeline_run_id,project_id,profile"
            f"&order=score.desc&limit={max(1, limit)}",
        )
        opportunities = [
            OpportunityRecord.from_supabase_row(row)
            for row in opportunity_rows
            if row.get("id")
        ]
        if not opportunities:
            return [], {}

        opportunity_ids = [opportunity.id for opportunity in opportunities]
        opportunity_id_filter = ",".join(opportunity_ids)
        link_rows = self.select(
            "opportunity_signals",
            f"select=opportunity_id,signal_id&opportunity_id=in.({opportunity_id_filter})",
        )
        signal_ids = sorted(
            {
                str(row.get("signal_id"))
                for row in link_rows
                if row.get("signal_id")
            }
        )
        signals_by_id: dict[str, SignalRecord] = {}
        if signal_ids:
            signal_id_filter = ",".join(signal_ids)
            signal_rows = self.select(
                "signals",
                f"select=id,source,title,body,url,tags,metadata&id=in.({signal_id_filter})",
            )
            signals_by_id = {
                str(row["id"]): SignalRecord.from_supabase_row(row)
                for row in signal_rows
                if row.get("id")
            }

        evidence_by_opportunity: dict[str, list[str]] = {}
        for row in link_rows:
            opportunity_id = str(row.get("opportunity_id") or "")
            signal_id = str(row.get("signal_id") or "")
            if opportunity_id and signal_id:
                evidence_by_opportunity.setdefault(opportunity_id, []).append(signal_id)
        for opportunity in opportunities:
            opportunity.evidence_signal_ids = evidence_by_opportunity.get(opportunity.id, [])
            opportunity.evidence_count = len(opportunity.evidence_signal_ids)
        return opportunities, signals_by_id

    def save_opportunity_clusters(
        self,
        clusters: list[OpportunityCluster],
        project_id: str | None = None,
    ) -> dict[str, Any]:
        run_row: dict[str, Any] = {
            "run_type": "managed",
            "status": "completed",
            "trigger": "managed_agent",
            "metadata": {
                "pipeline": "opportunity_clustering",
                "cluster_count": len(clusters),
                "clusters": [cluster.to_metadata() for cluster in clusters],
            },
        }
        if project_id:
            run_row["project_id"] = project_id
            run_row["metadata"]["project_id"] = project_id
        run = self.insert(
            "pipeline_runs",
            [run_row],
        )[0]
        return {
            "pipeline_run_id": run["id"],
            "clusters_saved_in_run_metadata": len(clusters),
        }

    def save_bull_bear_evaluation(
        self,
        result: BullBearEvaluation,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        cluster_metadata = result.cluster.to_metadata()
        run_row: dict[str, Any] = {
            "run_type": "managed",
            "status": "completed",
            "trigger": "managed_agent",
            "metadata": {
                "pipeline": "bull_bear_evaluation",
                "cluster": cluster_metadata,
                "evaluators": ["bull_agent", "bear_agent", "decision_agent", "synthesizer_agent"],
                "raw_output_chars": {
                    name: len(text)
                    for name, text in result.raw_outputs.items()
                },
            },
        }
        if project_id:
            run_row["project_id"] = project_id
            run_row["metadata"]["project_id"] = project_id
        run = self.insert(
            "pipeline_runs",
            [run_row],
        )[0]
        rows = []
        for evaluator, content in [
            ("bull_agent", result.bull),
            ("bear_agent", result.bear),
            ("decision_agent", result.decision),
            ("synthesizer_agent", result.synthesis),
        ]:
            rows.append(
                {
                    "opportunity_id": result.cluster.representative_opportunity_id,
                    "evaluator": evaluator,
                    "content": _evaluation_content(content),
                    "scores": {
                        "overall": _evaluation_score(content),
                        "cluster_run_id": run["id"],
                        "canonical_title": result.cluster.canonical_title,
                        "merged_opportunity_ids": result.cluster.merged_opportunity_ids,
                        "payload": content,
                    },
                }
            )
        self.insert("opportunity_evaluations", rows)
        return {
            "pipeline_run_id": run["id"],
            "evaluation_rows_saved": len(rows),
            "representative_opportunity_id": result.cluster.representative_opportunity_id,
        }

    def save(self, result: ManagedResearchResult) -> dict[str, Any]:
        run = self.insert(
            "pipeline_runs",
            [
                {
                    "run_type": "managed",
                    "status": "completed",
                    "trigger": "managed_agent",
                    "metadata": {
                        "agent": result.agent,
                        "signal_count": len(result.signals),
                        "opportunity_count": len(result.opportunities),
                    },
                }
            ],
        )[0]
        run_id = run["id"]

        signal_rows = self.insert("signals", [signal.to_supabase_row() for signal in result.signals])
        opportunity_rows = self.insert(
            "opportunities",
            [
                opportunity.to_supabase_row(pipeline_run_id=run_id)
                for opportunity in result.opportunities
            ],
        )

        evidence_rows: list[dict[str, Any]] = []
        evaluation_rows: list[dict[str, Any]] = []
        for opportunity, opportunity_row in zip(result.opportunities, opportunity_rows, strict=False):
            opportunity_id = opportunity_row.get("id")
            if not opportunity_id:
                continue
            for index in opportunity.source_indexes:
                if 0 <= index < len(signal_rows):
                    evidence_rows.append(
                        {
                            "opportunity_id": opportunity_id,
                            "signal_id": signal_rows[index]["id"],
                            "relevance": opportunity.score,
                            "notes": opportunity.score_rationale,
                        }
                    )
            evaluation_rows.append(
                {
                    "opportunity_id": opportunity_id,
                    "evaluator": result.agent,
                    "content": opportunity.score_rationale,
                    "scores": {"overall": opportunity.score},
                }
            )

        self.insert("opportunity_signals", evidence_rows)
        self.insert("opportunity_evaluations", evaluation_rows)
        return {
            "pipeline_run_id": run_id,
            "signals_saved": len(signal_rows),
            "opportunities_saved": len(opportunity_rows),
            "evidence_rows_saved": len(evidence_rows),
            "evaluation_rows_saved": len(evaluation_rows),
        }

    def save_trend_research(
        self,
        result: TrendResearchPipelineResult,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        run_row: dict[str, Any] = {
            "run_type": "managed",
            "status": "completed",
            "trigger": "managed_agent",
            "metadata": {
                "pipeline": "trend_research",
                "topic": result.topic,
                "trend_agent": result.trend.agent,
                "research_agent": result.research.agent,
                "media_item_count": len(result.trend.media_items),
                "research_finding_count": len(result.research_findings),
                "signal_count": len(result.research.signals),
                "opportunity_count": len(result.research.opportunities),
                "media_items": [
                    item.to_metadata()
                    for item in result.trend.media_items
                ],
                "research_findings": [
                    finding.to_metadata()
                    for finding in result.research_findings
                ],
                "raw_output_chars": {
                    "trend": len(result.trend.raw_text),
                    "research": len(result.research.raw_text),
                },
            },
        }
        if project_id:
            run_row["project_id"] = project_id
            run_row["metadata"]["project_id"] = project_id
        run = self.insert("pipeline_runs", [run_row])[0]
        run_id = run["id"]

        signal_rows = self.insert(
            "signals",
            [
                {
                    **signal.to_supabase_row(),
                    "metadata": {
                        **signal.metadata,
                        "pipeline": "trend_research",
                        "pipeline_run_id": run_id,
                        "trend_agent": result.trend.agent,
                        "research_agent": result.research.agent,
                        **({"project_id": project_id} if project_id else {}),
                    },
                    **({"project_id": project_id} if project_id else {}),
                }
                for signal in result.research.signals
            ],
        )
        opportunity_rows = self.insert(
            "opportunities",
            [
                {
                    **opportunity.to_supabase_row(pipeline_run_id=run_id),
                    **({"project_id": project_id} if project_id else {}),
                }
                for opportunity in result.research.opportunities
            ],
        )

        evidence_rows: list[dict[str, Any]] = []
        evaluation_rows: list[dict[str, Any]] = []
        for opportunity, opportunity_row in zip(result.research.opportunities, opportunity_rows, strict=False):
            opportunity_id = opportunity_row.get("id")
            if not opportunity_id:
                continue
            for index in opportunity.source_indexes:
                if 0 <= index < len(signal_rows):
                    evidence_rows.append(
                        {
                            "opportunity_id": opportunity_id,
                            "signal_id": signal_rows[index]["id"],
                            "relevance": opportunity.score,
                            "notes": opportunity.score_rationale,
                        }
                    )
            evaluation_rows.append(
                {
                    "opportunity_id": opportunity_id,
                    "evaluator": "trend_research_pipeline",
                    "content": opportunity.score_rationale,
                    "scores": {
                        "overall": opportunity.score,
                        "media_item_count": len(result.trend.media_items),
                        "research_finding_count": len(result.research_findings),
                    },
                }
            )

        self.insert("opportunity_signals", evidence_rows)
        self.insert("opportunity_evaluations", evaluation_rows)
        return {
            "pipeline_run_id": run_id,
            "media_items_saved_in_run_metadata": len(result.trend.media_items),
            "research_findings_saved_in_run_metadata": len(result.research_findings),
            "signals_saved": len(signal_rows),
            "opportunities_saved": len(opportunity_rows),
            "evidence_rows_saved": len(evidence_rows),
            "evaluation_rows_saved": len(evaluation_rows),
        }

    def save_seed_discovery(self, result: SeedDiscoveryResult) -> dict[str, Any]:
        run = self.insert(
            "pipeline_runs",
            [
                {
                    "run_type": "managed",
                    "status": "completed",
                    "trigger": "managed_agent",
                    "metadata": {
                        "pipeline": "seed_topics",
                        "theme": result.theme,
                        "agent": result.agent,
                        "seed_topic_count": len(result.seed_topics),
                        "seed_topics": [
                            topic.to_metadata()
                            for topic in result.seed_topics
                        ],
                        "raw_output_chars": len(result.raw_text),
                    },
                }
            ],
        )[0]
        return {
            "pipeline_run_id": run["id"],
            "seed_topics_saved_in_run_metadata": len(result.seed_topics),
        }

    def save_source_collection(self, result: SourceCollectionResult, project_id: str | None = None) -> dict[str, Any]:
        run_row: dict[str, Any] = {
            "run_type": "managed",
            "status": "completed",
            "trigger": "remote",
            "metadata": {
                "pipeline": "source_collect",
                "query": result.query,
                "collector": result.collector,
                "media_item_count": len(result.media_items),
                "seed_topic_count": len(result.seed_topics),
                "signal_count": len(result.signals),
                "opportunity_count": len(result.opportunities),
                "media_items": [
                    item.to_metadata()
                    for item in result.media_items
                ],
                "seed_topics": [
                    topic.to_metadata()
                    for topic in result.seed_topics
                ],
            },
        }
        if project_id:
            run_row["project_id"] = project_id
            run_row["metadata"]["project_id"] = project_id
        run = self.insert(
            "pipeline_runs",
            [run_row],
        )[0]
        run_id = run["id"]

        signal_rows_to_insert = []
        for signal in result.signals:
            row = {
                **signal.to_supabase_row(),
                "metadata": {
                    **signal.metadata,
                    "pipeline": "source_collect",
                    "pipeline_run_id": run_id,
                    "collector": result.collector,
                },
            }
            if project_id:
                row["project_id"] = project_id
                row["metadata"]["project_id"] = project_id
            signal_rows_to_insert.append(row)
        signal_rows = self.insert(
            "signals",
            signal_rows_to_insert,
        )
        opportunity_rows_to_insert = []
        for opportunity in result.opportunities:
            row = opportunity.to_supabase_row(pipeline_run_id=run_id)
            if project_id:
                row["project_id"] = project_id
            opportunity_rows_to_insert.append(row)
        opportunity_rows = self.insert(
            "opportunities",
            opportunity_rows_to_insert,
        )

        evidence_rows: list[dict[str, Any]] = []
        evaluation_rows: list[dict[str, Any]] = []
        for opportunity, opportunity_row in zip(result.opportunities, opportunity_rows, strict=False):
            opportunity_id = opportunity_row.get("id")
            if not opportunity_id:
                continue
            for index in opportunity.source_indexes:
                if 0 <= index < len(signal_rows):
                    evidence_rows.append(
                        {
                            "opportunity_id": opportunity_id,
                            "signal_id": signal_rows[index]["id"],
                            "relevance": opportunity.score,
                            "notes": opportunity.score_rationale,
                        }
                    )
            evaluation_rows.append(
                {
                    "opportunity_id": opportunity_id,
                    "evaluator": "deterministic_source_collect",
                    "content": opportunity.score_rationale,
                    "scores": {
                        "overall": opportunity.score,
                        "media_item_count": len(result.media_items),
                    },
                }
            )

        self.insert("opportunity_signals", evidence_rows)
        self.insert("opportunity_evaluations", evaluation_rows)
        return {
            "pipeline_run_id": run_id,
            "media_items_saved_in_run_metadata": len(result.media_items),
            "seed_topics_saved_in_run_metadata": len(result.seed_topics),
            "signals_saved": len(signal_rows),
            "opportunities_saved": len(opportunity_rows),
            "evidence_rows_saved": len(evidence_rows),
            "evaluation_rows_saved": len(evaluation_rows),
        }


def _evaluation_content(content: dict[str, Any]) -> str:
    for key in ("summary", "recommendation", "product_pitch", "position", "rationale"):
        value = content.get(key)
        if value:
            return str(value)
    return json.dumps(content, sort_keys=True)


def _evaluation_score(content: dict[str, Any]) -> float:
    for key in ("confidence", "score", "overall"):
        value = content.get(key)
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            continue
    return 0.0
