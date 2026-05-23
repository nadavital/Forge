from forge_ingestion_agent.models import PainPoint, Signal
from forge_ingestion_agent.supabase import SupabaseClient


class FakeSupabaseClient(SupabaseClient):
    def __init__(self):
        self.rows = {}

    def insert(self, table, rows):
        stored = []
        for index, row in enumerate(rows):
            stored.append({"id": f"{table}-{index}", **row})
        self.rows.setdefault(table, []).extend(stored)
        return stored


def test_save_ingestion_result_writes_expected_tables():
    client = FakeSupabaseClient()
    signals = [
        Signal(source="reddit", source_id="r1", title="Pain", body="This API is hard to use.")
    ]
    pain_points = [
        PainPoint(
            title="Fix hard API workflows",
            problem="This API is hard to use.",
            target_user="Developers",
            mvp_concept="A wrapper tool",
            score=0.8,
            score_rationale="Matched hard",
            source_signal_keys=["reddit:r1"],
        )
    ]

    result = client.save_ingestion_result(signals, pain_points, trigger="fixture")

    assert result["signals_saved"] == 1
    assert result["opportunities_saved"] == 1
    assert result["evidence_rows_saved"] == 1
    assert result["evaluation_rows_saved"] == 1
    assert "pipeline_runs" in client.rows
    assert "opportunities" in client.rows

