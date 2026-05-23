from forge_managed_research.api import (
    PIPELINE_STAGES,
    RUN_STATUSES,
    _build_prompt_context,
    _parse_builder_report,
    _run_response,
    _simulated_builder_report,
)


def test_status_constants_match_frontend_contract():
    assert RUN_STATUSES == {"queued", "in_progress", "completed", "failed"}
    assert "bull_bear" in PIPELINE_STAGES
    assert "synthesis" in PIPELINE_STAGES


def test_run_response_uses_contract_shape():
    row = {
        "id": "run-1",
        "project_id": "project-1",
        "status": "in_progress",
        "stage": "signal_collection",
        "trigger": "manual",
        "started_at": "2026-05-23T00:00:00Z",
        "completed_at": None,
        "error": None,
        "summary": None,
        "metadata": {},
    }

    assert _run_response(row) == {
        "id": "run-1",
        "project_id": "project-1",
        "status": "in_progress",
        "stage": "signal_collection",
        "trigger": "manual",
        "started_at": "2026-05-23T00:00:00Z",
        "completed_at": None,
        "error": None,
        "summary": None,
    }


def test_build_prompt_context_prioritizes_user_notes():
    context = _build_prompt_context(
        project={"id": "project-1", "repo_url": "https://github.com/user/repo"},
        opportunity={
            "id": "opp-1",
            "title": "Tool Guard",
            "problem": "Tool schemas break",
            "mvp_concept": "Schema validator",
            "user_notes": "saved note",
            "synthesis": {"builder_system_prompt": "agent prompt"},
        },
        user_notes="request note",
    )

    assert list(context.keys())[:3] == [
        "user_notes",
        "saved_user_notes",
        "builder_system_prompt",
    ]
    assert context["user_notes"] == "request note"
    assert context["saved_user_notes"] == "saved note"
    assert context["builder_system_prompt"] == "agent prompt"


def test_builder_report_parses_fenced_json():
    report = _parse_builder_report(
        """Done.
```json
{"branch_name":"forge/tool-guard","pr_url":"https://github.com/user/repo/pull/7","summary":"opened"}
```
"""
    )

    assert report["branch_name"] == "forge/tool-guard"
    assert report["pr_url"].endswith("/pull/7")


def test_simulated_builder_report_uses_target_repo():
    report = _simulated_builder_report(
        {
            "id": "123456789",
            "repo_url": "https://github.com/user/repo",
        }
    )

    assert report["branch_name"] == "forge/build-12345678"
    assert report["pr_url"] == "https://github.com/user/repo/pull/1"
