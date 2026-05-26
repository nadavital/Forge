from typing import Any

from forge_managed_research.schemas import (
    ManagedOpportunity,
    ManagedResearchResult,
    ManagedSignal,
    SeedDiscoveryResult,
    SeedTopic,
)
from forge_managed_research.supabase import SupabaseWriter


class RecordingWriter(SupabaseWriter):
    def __init__(self) -> None:
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.next_id = 1

    def insert(self, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        inserted: list[dict[str, Any]] = []
        for row in rows:
            stored = {**row, "id": row.get("id") or f"{table}-{self.next_id}"}
            self.next_id += 1
            self.rows.setdefault(table, []).append(stored)
            inserted.append(stored)
        return inserted


def test_managed_research_save_attaches_project_id_to_rows():
    writer = RecordingWriter()
    result = ManagedResearchResult(
        raw_text="{}",
        agent="antigravity",
        signals=[
            ManagedSignal(
                source="github",
                title="Pain",
                body="Developers need scoped research records.",
                metadata={"source": "fixture"},
            )
        ],
        opportunities=[
            ManagedOpportunity(
                title="Scoped runs",
                problem="Rows without project ids leak across products.",
                target_user="Forge operator",
                mvp_concept="Attach project ids consistently.",
                score=0.8,
                score_rationale="Keeps product context debuggable.",
                source_indexes=[0],
            )
        ],
    )

    writer.save(result, project_id="project-1")

    assert writer.rows["pipeline_runs"][0]["project_id"] == "project-1"
    assert writer.rows["pipeline_runs"][0]["metadata"]["project_id"] == "project-1"
    assert writer.rows["signals"][0]["project_id"] == "project-1"
    assert writer.rows["signals"][0]["metadata"]["project_id"] == "project-1"
    assert writer.rows["opportunities"][0]["project_id"] == "project-1"


def test_seed_discovery_save_attaches_project_id_to_run():
    writer = RecordingWriter()
    result = SeedDiscoveryResult(
        raw_text="{}",
        agent="antigravity",
        theme="agent builder pain",
        seed_topics=[
            SeedTopic(
                topic="builder evals",
                title="Builder evals",
                rationale="Users need proof.",
                score=0.7,
            )
        ],
    )

    writer.save_seed_discovery(result, project_id="project-1")

    assert writer.rows["pipeline_runs"][0]["project_id"] == "project-1"
    assert writer.rows["pipeline_runs"][0]["metadata"]["project_id"] == "project-1"
