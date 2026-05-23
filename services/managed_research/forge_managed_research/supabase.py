"""Supabase persistence for managed-agent research output."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .schemas import ManagedResearchResult, TrendResearchPipelineResult


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

    def save_trend_research(self, result: TrendResearchPipelineResult) -> dict[str, Any]:
        run = self.insert(
            "pipeline_runs",
            [
                {
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
            ],
        )[0]
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
                    },
                }
                for signal in result.research.signals
            ],
        )
        opportunity_rows = self.insert(
            "opportunities",
            [
                opportunity.to_supabase_row(pipeline_run_id=run_id)
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
