"""Supabase persistence for ingestion output."""

from __future__ import annotations

from typing import Any

from .config import Settings, require_supabase
from .http import post_json
from .models import PainPoint, Signal, signal_key


class SupabaseClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = require_supabase(settings)
        self.headers = {
            "apikey": self.settings.supabase_service_role_key,
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
        }

    def insert(self, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        url = f"{self.settings.supabase_url}/rest/v1/{table}"
        result = post_json(url, rows, self.headers)
        if isinstance(result, list):
            return result
        return [result]

    def save_ingestion_result(
        self,
        signals: list[Signal],
        pain_points: list[PainPoint],
        trigger: str = "managed_agent",
    ) -> dict[str, Any]:
        run = self.insert(
            "pipeline_runs",
            [
                {
                    "run_type": "ranking",
                    "status": "completed",
                    "trigger": trigger,
                    "metadata": {
                        "signal_count": len(signals),
                        "opportunity_count": len(pain_points),
                    },
                }
            ],
        )[0]
        run_id = run["id"]

        signal_rows = self.insert("signals", [signal.to_supabase_row() for signal in signals])
        signal_ids_by_key = {
            signal_key(signal): row.get("id")
            for signal, row in zip(signals, signal_rows, strict=False)
            if row.get("id")
        }

        opportunity_rows = self.insert(
            "opportunities",
            [pain_point.to_opportunity_row(pipeline_run_id=run_id) for pain_point in pain_points],
        )

        evidence_rows: list[dict[str, Any]] = []
        evaluation_rows: list[dict[str, Any]] = []
        for pain_point, opportunity_row in zip(pain_points, opportunity_rows, strict=False):
            opportunity_id = opportunity_row.get("id")
            if not opportunity_id:
                continue
            for key in pain_point.source_signal_keys:
                signal_id = signal_ids_by_key.get(key)
                if signal_id:
                    evidence_rows.append(
                        {
                            "opportunity_id": opportunity_id,
                            "signal_id": signal_id,
                            "relevance": pain_point.score,
                            "notes": pain_point.score_rationale,
                        }
                    )
            evaluation_rows.append(
                {
                    "opportunity_id": opportunity_id,
                    "evaluator": "ingestion_agent",
                    "content": pain_point.score_rationale,
                    "scores": {
                        "overall": pain_point.score,
                        "source_signal_keys": pain_point.source_signal_keys,
                    },
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

