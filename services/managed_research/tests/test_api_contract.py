import os

from fastapi import HTTPException
from fastapi.testclient import TestClient

from forge_managed_research import api
from forge_managed_research.api import (
    PIPELINE_STAGES,
    RUN_STATUSES,
    app,
    _managed_research_auth_error,
    _require_managed_research_auth,
    _build_prompt_context,
    _brief_query,
    _collector_config_for_payload,
    _parse_builder_report,
    _project_query,
    _projects_query,
    _github_token_for_collection,
    _run_research_brief_payload,
    _run_response,
    _scoped_opportunity_row,
    _simulated_builder_report,
)
from forge_managed_research.schemas import MediaItem


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


def test_managed_research_auth_requires_bearer_secret():
    previous = os.environ.get("FORGE_MANAGED_RESEARCH_SECRET")
    previous_allow = os.environ.get("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH")
    try:
        os.environ["FORGE_MANAGED_RESEARCH_SECRET"] = "research-secret"
        os.environ.pop("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", None)

        _require_managed_research_auth(FakeRequest("Bearer research-secret"))

        try:
            _require_managed_research_auth(FakeRequest("Bearer wrong"))
        except HTTPException as exc:
            assert exc.status_code == 401
        else:  # pragma: no cover
            raise AssertionError("expected unauthorized request to fail")
    finally:
        if previous is None:
            os.environ.pop("FORGE_MANAGED_RESEARCH_SECRET", None)
        else:
            os.environ["FORGE_MANAGED_RESEARCH_SECRET"] = previous
        if previous_allow is None:
            os.environ.pop("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", None)
        else:
            os.environ["FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH"] = previous_allow


def test_managed_research_api_routes_share_bearer_gate():
    previous = os.environ.get("FORGE_MANAGED_RESEARCH_SECRET")
    previous_allow = os.environ.get("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH")
    try:
        os.environ["FORGE_MANAGED_RESEARCH_SECRET"] = "research-secret"
        os.environ.pop("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", None)
        client = TestClient(app)

        health = client.get("/health")
        assert health.status_code == 200

        unauthorized = client.get("/api/projects")
        assert unauthorized.status_code == 401
        assert unauthorized.json()["detail"] == "managed research authorization required"
    finally:
        if previous is None:
            os.environ.pop("FORGE_MANAGED_RESEARCH_SECRET", None)
        else:
            os.environ["FORGE_MANAGED_RESEARCH_SECRET"] = previous
        if previous_allow is None:
            os.environ.pop("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", None)
        else:
            os.environ["FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH"] = previous_allow


def test_managed_research_requires_secret_unless_unauthenticated_mode_is_explicit():
    previous_secret = os.environ.get("FORGE_MANAGED_RESEARCH_SECRET")
    previous_allow = os.environ.get("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH")
    try:
        os.environ.pop("FORGE_MANAGED_RESEARCH_SECRET", None)
        os.environ.pop("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", None)

        assert _managed_research_auth_error(FakeRequest("")) == "FORGE_MANAGED_RESEARCH_SECRET is required"

        os.environ["FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH"] = "1"
        assert _managed_research_auth_error(FakeRequest("")) is None
    finally:
        if previous_secret is None:
            os.environ.pop("FORGE_MANAGED_RESEARCH_SECRET", None)
        else:
            os.environ["FORGE_MANAGED_RESEARCH_SECRET"] = previous_secret
        if previous_allow is None:
            os.environ.pop("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", None)
        else:
            os.environ["FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH"] = previous_allow


def test_managed_research_project_queries_include_request_scope():
    scope = {"owner_user_id": "user 1", "workspace_id": "workspace/1"}

    assert _projects_query(scope) == (
        "select=*&owner_user_id=eq.user%201&workspace_id=eq.workspace%2F1&order=updated_at.desc"
    )
    assert _project_query("project-1", scope) == (
        "select=*&id=eq.project-1&owner_user_id=eq.user%201&workspace_id=eq.workspace%2F1&limit=1"
    )


def test_raw_opportunity_routes_require_project_scope():
    writer = FakeWriter(
        opportunities=[
            {"id": "opp-1", "project_id": "project-1", "title": "Scoped"},
            {"id": "opp-legacy", "project_id": None, "title": "Legacy"},
        ],
        projects=[
            {
                "id": "project-1",
                "owner_user_id": "user_1",
                "workspace_id": "workspace_1",
                "name": "Scoped project",
                "mode": "new_product",
                "created_at": "2026-05-25T00:00:00Z",
                "updated_at": "2026-05-25T00:00:00Z",
            }
        ],
    )

    scoped = _scoped_opportunity_row(
        writer,
        "opp-1",
        FakeRequest("", {"x-forge-user-id": "user_1", "x-forge-workspace-id": "workspace_1"}),
    )

    assert scoped["id"] == "opp-1"
    assert any("owner_user_id=eq.user_1" in query and "workspace_id=eq.workspace_1" in query for query in writer.queries)

    try:
        _scoped_opportunity_row(writer, "opp-1", FakeRequest("", {"x-forge-user-id": "other"}))
    except HTTPException as exc:
        assert exc.status_code == 404
    else:  # pragma: no cover
        raise AssertionError("expected wrong user scope to be rejected")

    try:
        _scoped_opportunity_row(writer, "opp-legacy", FakeRequest("", {"x-forge-user-id": "user_1"}))
    except HTTPException as exc:
        assert exc.status_code == 404
    else:  # pragma: no cover
        raise AssertionError("expected project-less opportunities to be hidden from raw routes")


def test_research_brief_response_echoes_request_scope(monkeypatch):
    monkeypatch.setattr(api, "collect_public_media", lambda _config: [])
    payload = {
        "project": {"name": "Idea Forge"},
        "research_brief": {
            "hypothesis": "Solo founders need better idea validation",
            "target_users": ["solo founders"],
            "pain_area": "choosing credible product ideas",
            "source_plan": ["public founder communities"],
            "mvp_boundaries": ["research brief compiler"],
            "disqualifying_evidence": ["existing tools solve this fully"],
        },
        "limit_per_source": 0,
        "max_opportunities": 1,
    }

    response = _run_research_brief_payload(
        payload,
        request_scope={"owner_user_id": "user_1", "workspace_id": "workspace_1"},
    )

    assert response["request_scope"] == {
        "owner_user_id": "user_1",
        "workspace_id": "workspace_1",
    }
    assert response["evidence_summary"] == {
        "opportunities": 0,
        "build_ready_opportunities": 0,
        "needs_more_evidence_opportunities": 0,
        "reasons": [],
    }


def test_research_brief_query_preserves_user_context():
    query = _brief_query(
        {
            "hypothesis": "Solo founders need better idea validation",
            "target_users": ["solo founders"],
            "pain_area": "choosing credible product ideas",
            "constraints": ["No paid APIs"],
            "source_plan": ["public founder communities"],
            "disqualifying_evidence": ["existing tools solve this fully"],
            "mvp_boundaries": ["research brief compiler"],
            "user_taste_notes": ["calm product partner"],
            "open_questions": ["which founder segment repeats the pain weekly"],
        },
        {"name": "Idea Forge"},
    )

    assert "No paid APIs" in query
    assert "existing tools solve this fully" in query
    assert "research brief compiler" in query
    assert "calm product partner" in query
    assert "which founder segment repeats the pain weekly" in query


def test_research_brief_source_plan_routes_collector_config():
    config = _collector_config_for_payload(
        query="agent evals",
        payload={"github_access_token": "short_lived"},
        brief={
            "source_plan": [
                "GitHub issues in agent framework repos",
                "Reddit r/LocalLLaMA posts",
                "Stack Overflow questions",
            ]
        },
        limit_per_source=3,
    )

    assert config.enabled_sources == ("reddit", "stack_exchange", "github")
    assert "LocalLLaMA" in config.reddit_subreddits
    assert "stackoverflow" in config.stack_exchange_sites
    assert config.github_token == "short_lived"
    assert config.source_plan[0] == "GitHub issues in agent framework repos"


def test_research_brief_payload_passes_source_plan_to_collector():
    captured = []
    previous_collect = api.collect_public_media
    try:
        api.collect_public_media = lambda config: captured.append(config) or []
        _run_research_brief_payload(
            {
                "project": {"name": "Idea Forge"},
                "research_brief": {
                    "hypothesis": "Developers need better agent eval debugging",
                    "target_users": ["AI app developers"],
                    "pain_area": "debugging agent failures",
                    "source_plan": ["GitHub issues in agent framework repos"],
                },
                "limit_per_source": 2,
                "max_opportunities": 1,
            }
        )
    finally:
        api.collect_public_media = previous_collect

    assert len(captured) == 1
    assert captured[0].enabled_sources == ("github",)
    assert captured[0].source_plan == ("GitHub issues in agent framework repos",)


def test_research_brief_fallback_evaluation_preserves_user_context():
    previous_collect = api.collect_public_media
    try:
        api.collect_public_media = lambda _config: [
            MediaItem(
                source="hacker_news",
                title="Founders struggle to validate ideas",
                summary="Solo founders struggle to prioritize credible product ideas weekly.",
                url="https://example.com/founder-pain",
                tags=["founder", "idea"],
            )
        ]
        payload = {
            "project": {"name": "Idea Forge"},
            "research_brief": {
                "hypothesis": "Solo founders need better idea validation",
                "target_users": ["solo founders"],
                "pain_area": "choosing credible product ideas",
                "constraints": ["No paid APIs"],
                "source_plan": ["public founder communities"],
                "disqualifying_evidence": ["existing tools solve this fully"],
                "mvp_boundaries": ["research brief compiler"],
                "user_taste_notes": ["calm product partner"],
                "open_questions": ["which founder segment repeats the pain weekly"],
            },
            "limit_per_source": 1,
            "max_opportunities": 1,
        }

        response = _run_research_brief_payload(payload)
        opportunity = response["opportunities"][0]
        evaluations = {
            row["evaluator"]: row["scores"]["payload"]
            for row in opportunity["evaluations"]
        }

        assert opportunity["profile"]["constraints"] == ["No paid APIs"]
        assert opportunity["profile"]["evidence_sufficient_for_build"] is False
        assert opportunity["profile"]["user_taste_notes"] == ["calm product partner"]
        assert response["evidence_summary"]["build_ready_opportunities"] == 0
        assert response["evidence_summary"]["needs_more_evidence_opportunities"] == 1
        assert "No paid APIs" in evaluations["decision_agent"]["required_mvp_constraints"]
        assert evaluations["decision_agent"]["recommendation"] == "research_more"
        assert evaluations["synthesizer_agent"]["builder_readiness"] == "not_ready"
        assert evaluations["synthesizer_agent"]["builder_system_prompt"] == ""
        assert "existing tools solve this fully" in evaluations["synthesizer_agent"]["non_goals"]
        assert "calm product partner" in " ".join(evaluations["bull"]["adoption_case"])
        assert "which founder segment repeats the pain weekly" in " ".join(evaluations["bear"]["missing_evidence"])
    finally:
        api.collect_public_media = previous_collect


def test_research_brief_fallback_can_mark_evidence_ready_for_prototype():
    previous_collect = api.collect_public_media
    try:
        api.collect_public_media = lambda _config: [
            MediaItem(
                source="hacker_news",
                title="Founders struggle to validate ideas",
                summary="Solo founders struggle to prioritize credible product ideas weekly.",
                url="https://example.com/founder-pain",
                tags=["founder", "idea"],
            ),
            MediaItem(
                source="stack_exchange",
                title="Idea validation is hard",
                summary="Developers ask how to validate product ideas before building.",
                url="https://example.com/validation-pain",
                tags=["founder", "idea"],
            ),
        ]
        payload = {
            "project": {"name": "Idea Forge"},
            "research_brief": {
                "hypothesis": "Solo founders need better idea validation",
                "target_users": ["solo founders"],
                "pain_area": "choosing credible product ideas",
                "constraints": ["No paid APIs"],
                "source_plan": ["public founder communities"],
                "disqualifying_evidence": ["existing tools solve this fully"],
                "mvp_boundaries": ["research brief compiler"],
            },
            "limit_per_source": 2,
            "max_opportunities": 1,
        }

        response = _run_research_brief_payload(payload)
        opportunity = response["opportunities"][0]
        evaluations = {
            row["evaluator"]: row["scores"]["payload"]
            for row in opportunity["evaluations"]
        }

        assert opportunity["profile"]["evidence_sufficient_for_build"] is True
        assert response["evidence_summary"]["build_ready_opportunities"] == 1
        assert evaluations["decision_agent"]["recommendation"] == "prototype"
        assert evaluations["synthesizer_agent"]["builder_readiness"] == "ready"
        assert "Build a local runnable prototype" in evaluations["synthesizer_agent"]["builder_system_prompt"]
    finally:
        api.collect_public_media = previous_collect


def test_managed_research_prefers_request_scoped_github_token():
    previous_fallback = os.environ.get("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK")
    previous_token = os.environ.get("GITHUB_TOKEN")
    try:
        os.environ["FORGE_ALLOW_GITHUB_TOKEN_FALLBACK"] = "1"
        os.environ["GITHUB_TOKEN"] = "broad_token"

        assert _github_token_for_collection({"github_access_token": "short_lived"}) == "short_lived"
        assert _github_token_for_collection({}) == "broad_token"
    finally:
        if previous_fallback is None:
            os.environ.pop("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", None)
        else:
            os.environ["FORGE_ALLOW_GITHUB_TOKEN_FALLBACK"] = previous_fallback
        if previous_token is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = previous_token


class FakeWriter:
    def __init__(self, opportunities=None, projects=None) -> None:
        self.opportunities = opportunities or []
        self.projects = projects or []
        self.queries: list[str] = []

    def select(self, table: str, query: str) -> list[dict]:
        self.queries.append(query)
        if table == "opportunities":
            return _rows_matching_id(self.opportunities, query)
        if table == "projects":
            return [
                row
                for row in _rows_matching_id(self.projects, query)
                if _query_allows(row, "owner_user_id", query) and _query_allows(row, "workspace_id", query)
            ]
        if table in {"project_schedules", "project_runs"}:
            return []
        raise AssertionError(f"unexpected table: {table}")


class FakeRequest:
    def __init__(self, authorization: str, headers: dict[str, str] | None = None) -> None:
        self.headers = {"authorization": authorization, **(headers or {})}


def _rows_matching_id(rows: list[dict], query: str) -> list[dict]:
    expected = _query_filter(query, "id")
    return [row for row in rows if not expected or row.get("id") == expected]


def _query_allows(row: dict, key: str, query: str) -> bool:
    expected = _query_filter(query, key)
    return expected is None or row.get(key) == expected


def _query_filter(query: str, key: str) -> str | None:
    marker = f"{key}=eq."
    for part in query.split("&"):
        if part.startswith(marker):
            return part[len(marker):]
    return None
