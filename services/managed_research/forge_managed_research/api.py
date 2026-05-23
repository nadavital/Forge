"""HTTP API for the Forge dashboard contract."""

from __future__ import annotations

import os
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException

from .clustering import cluster_opportunities
from .collectors import CollectorConfig, collect_public_media
from .env import load_repo_env
from .evaluate import _run_managed_evaluation
from .interactions import ManagedAgentClient
from .local_synthesis import (
    synthesize_opportunities,
    synthesize_seed_topics,
    synthesize_signals,
)
from .schemas import SourceCollectionResult
from .schemas import BullBearEvaluation
from .schemas import TrendResearchPipelineResult
from .supabase import SupabaseWriter

REPO_ROOT = Path(__file__).resolve().parents[3]
load_repo_env(REPO_ROOT)
AGENTS_DIR = REPO_ROOT / ".agents"

DEFAULT_SCHEDULE = {
    "enabled": True,
    "cron": "0 8 * * 1-5",
    "timezone": "America/Los_Angeles",
}

RUN_STATUSES = {"queued", "in_progress", "completed", "failed"}
PIPELINE_STAGES = {
    "project_analysis",
    "signal_collection",
    "opportunity_clustering",
    "bull_bear",
    "synthesis",
    "ready",
    "failed",
}
OPPORTUNITY_ACTIONS = {"watch", "reject", "research_more", "approve_for_build"}

app = FastAPI(title="Forge Backend API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/projects")
def create_project(payload: dict[str, Any]) -> dict[str, Any]:
    mode = payload.get("mode")
    if mode not in {"new_project", "existing_project"}:
        raise HTTPException(status_code=400, detail="mode must be new_project or existing_project")
    name = payload.get("name") or _default_project_name(payload)
    description = str(payload.get("description") or "")
    repo_url = payload.get("repo_url") or None
    schedule = {**DEFAULT_SCHEDULE, **(payload.get("schedule") or {})}
    writer = SupabaseWriter()
    project = writer.insert(
        "projects",
        [
            {
                "name": name,
                "mode": mode,
                "repo_url": repo_url,
                "description": description,
                "product_context": payload.get("product_context"),
            }
        ],
    )[0]
    writer.insert(
        "project_schedules",
        [
            {
                "project_id": project["id"],
                "enabled": bool(schedule.get("enabled", True)),
                "cron": str(schedule.get("cron") or DEFAULT_SCHEDULE["cron"]),
                "timezone": str(schedule.get("timezone") or DEFAULT_SCHEDULE["timezone"]),
            }
        ],
    )
    return {
        "project": _project_response(writer, project["id"]),
        "next_recommended_action": "run_discovery",
    }


@app.get("/api/projects")
def list_projects() -> dict[str, Any]:
    writer = SupabaseWriter()
    rows = writer.select("projects", "select=*&order=updated_at.desc")
    return {"projects": [_project_response(writer, row["id"]) for row in rows]}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    return {"project": _project_response(SupabaseWriter(), project_id)}


@app.patch("/api/projects/{project_id}")
def update_project(project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    writer = SupabaseWriter()
    allowed = {"name", "description", "repo_url", "product_context"}
    values = {key: payload[key] for key in allowed if key in payload}
    if values:
        values["updated_at"] = _now()
        _expect_one(writer.update("projects", f"id=eq.{project_id}", values), "project")
    if "schedule" in payload:
        schedule = {**DEFAULT_SCHEDULE, **(payload.get("schedule") or {})}
        rows = writer.update(
            "project_schedules",
            f"project_id=eq.{project_id}",
            {
                "enabled": bool(schedule.get("enabled", True)),
                "cron": str(schedule.get("cron") or DEFAULT_SCHEDULE["cron"]),
                "timezone": str(schedule.get("timezone") or DEFAULT_SCHEDULE["timezone"]),
                "updated_at": _now(),
            },
        )
        if not rows:
            writer.insert(
                "project_schedules",
                [
                    {
                        "project_id": project_id,
                        "enabled": bool(schedule.get("enabled", True)),
                        "cron": str(schedule.get("cron") or DEFAULT_SCHEDULE["cron"]),
                        "timezone": str(schedule.get("timezone") or DEFAULT_SCHEDULE["timezone"]),
                    }
                ],
            )
    return {"project": _project_response(writer, project_id)}


@app.post("/api/projects/{project_id}/brainstorm")
def brainstorm_project(project_id: str, payload: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, Any]:
    writer = SupabaseWriter()
    _project_response(writer, project_id)
    run = _create_project_run(writer, project_id, trigger="onboarding", stage="project_analysis")
    background_tasks.add_task(_background_brainstorm, project_id, run["id"], payload)
    return {"run": _run_response(run)}


@app.post("/api/projects/{project_id}/import-github")
def import_github(project_id: str, payload: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, Any]:
    repo_url = payload.get("repo_url")
    if not repo_url:
        raise HTTPException(status_code=400, detail="repo_url is required")
    writer = SupabaseWriter()
    writer.update("projects", f"id=eq.{project_id}", {"repo_url": repo_url, "updated_at": _now()})
    run = _create_project_run(writer, project_id, trigger="onboarding", stage="project_analysis")
    background_tasks.add_task(_background_import_github, project_id, run["id"], repo_url)
    return {"run": _run_response(run)}


@app.post("/api/projects/{project_id}/runs")
def start_project_run(project_id: str, payload: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, Any]:
    writer = SupabaseWriter()
    _project_response(writer, project_id)
    trigger = payload.get("trigger") or "manual"
    if trigger not in {"manual", "scheduled", "onboarding"}:
        raise HTTPException(status_code=400, detail="invalid run trigger")
    run = _create_project_run(writer, project_id, trigger=trigger, stage="signal_collection")
    background_tasks.add_task(_background_discovery_run, project_id, run["id"], payload)
    return {"run": _run_response(run)}


@app.get("/api/projects/{project_id}/runs")
def list_project_runs(project_id: str) -> dict[str, Any]:
    writer = SupabaseWriter()
    _project_response(writer, project_id)
    rows = writer.select("project_runs", f"select=*&project_id=eq.{project_id}&order=started_at.desc")
    return {"runs": [_run_response(row) for row in rows]}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    row = _expect_one(SupabaseWriter().select("project_runs", f"select=*&id=eq.{run_id}"), "run")
    return {"run": _run_response(row)}


@app.get("/api/projects/{project_id}/opportunities")
def list_opportunities(project_id: str) -> dict[str, Any]:
    writer = SupabaseWriter()
    _project_response(writer, project_id)
    rows = writer.select(
        "opportunities",
        f"select=*&project_id=eq.{project_id}&status=in.(recommended,approved,building,built,watched)&order=score.desc",
    )
    return {"opportunities": [_opportunity_card(writer, row) for row in rows]}


@app.get("/api/opportunities/{opportunity_id}")
def get_opportunity(opportunity_id: str) -> dict[str, Any]:
    writer = SupabaseWriter()
    row = _expect_one(writer.select("opportunities", f"select=*&id=eq.{opportunity_id}"), "opportunity")
    return {"opportunity": _opportunity_detail(writer, row)}


@app.post("/api/opportunities/{opportunity_id}/actions")
def opportunity_action(opportunity_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action not in OPPORTUNITY_ACTIONS:
        raise HTTPException(status_code=400, detail="invalid opportunity action")
    writer = SupabaseWriter()
    opportunity = _expect_one(writer.select("opportunities", f"select=*&id=eq.{opportunity_id}"), "opportunity")
    status = {
        "watch": "watched",
        "reject": "rejected",
        "research_more": "watched",
        "approve_for_build": "approved",
    }[action]
    writer.insert(
        "opportunity_actions",
        [
            {
                "opportunity_id": opportunity_id,
                "project_id": opportunity.get("project_id"),
                "action": action,
                "user_notes": payload.get("user_notes"),
            }
        ],
    )
    updated = _expect_one(
        writer.update("opportunities", f"id=eq.{opportunity_id}", {"status": status, "updated_at": _now()}),
        "opportunity",
    )
    return {
        "opportunity": {
            "id": updated["id"],
            "status": updated["status"],
            "user_notes": payload.get("user_notes"),
        }
    }


@app.post("/api/opportunities/{opportunity_id}/builds")
def start_build(opportunity_id: str, payload: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, Any]:
    writer = SupabaseWriter()
    opportunity = _expect_one(writer.select("opportunities", f"select=*&id=eq.{opportunity_id}"), "opportunity")
    project_id = opportunity.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="opportunity is not linked to a project")
    project = _project_response(writer, project_id)
    repo_url = project.get("repo_url")
    if not repo_url:
        raise HTTPException(status_code=400, detail="project repo_url is required before build")
    detail = _opportunity_detail(writer, opportunity)
    prompt_context = _build_prompt_context(project, detail, payload.get("user_notes"))
    build = writer.insert(
        "mvp_builds",
        [
            {
                "project_id": project_id,
                "opportunity_id": opportunity_id,
                "status": "in_progress",
                "stage": "starting_managed_builder",
                "repo_url": repo_url,
                "build_type": payload.get("build_type") or "prototype_pr",
                "user_notes": payload.get("user_notes"),
                "prompt_context": prompt_context,
            }
        ],
    )[0]
    writer.update("opportunities", f"id=eq.{opportunity_id}", {"status": "building", "updated_at": _now()})
    background_tasks.add_task(_background_build, build["id"])
    return {"build": _build_response(build)}


@app.get("/api/builds/{build_id}")
def get_build(build_id: str) -> dict[str, Any]:
    build = _expect_one(SupabaseWriter().select("mvp_builds", f"select=*&id=eq.{build_id}"), "build")
    return {"build": _build_response(build)}


def _background_brainstorm(project_id: str, run_id: str, payload: dict[str, Any]) -> None:
    writer = SupabaseWriter()
    try:
        prompt = payload.get("user_prompt") or "developer tools and AI agent product opportunities"
        constraints = ", ".join(payload.get("constraints") or [])
        context = f"Brainstorm prompt: {prompt}. Constraints: {constraints}".strip()
        if os.environ.get("FORGE_ENABLE_MANAGED_BRAINSTORM") == "1":
            raw = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY")).run_topic_seeder(
                context,
                agents_dir=AGENTS_DIR,
                max_topics=3,
            )
            context = f"{context}\n\nManaged brainstorm output:\n{raw[:4000]}"
        writer.update(
            "projects",
            f"id=eq.{project_id}",
            {"product_context": context, "updated_at": _now()},
        )
        _complete_project_run(writer, run_id, "ready", "Project context prepared.")
    except Exception as exc:  # pragma: no cover - background failure path
        _fail_project_run(writer, run_id, exc)


def _background_import_github(project_id: str, run_id: str, repo_url: str) -> None:
    writer = SupabaseWriter()
    try:
        context = f"Imported GitHub repo: {repo_url}. Analyze README, issues, and product surface during discovery runs."
        writer.update(
            "projects",
            f"id=eq.{project_id}",
            {"product_context": context, "updated_at": _now()},
        )
        writer.insert(
            "project_source_configs",
            [
                {
                    "project_id": project_id,
                    "source_type": "github",
                    "config": {"repo_url": repo_url},
                    "enabled": True,
                }
            ],
        )
        _complete_project_run(writer, run_id, "ready", "GitHub project imported.")
    except Exception as exc:  # pragma: no cover
        _fail_project_run(writer, run_id, exc)


def _background_discovery_run(project_id: str, run_id: str, payload: dict[str, Any]) -> None:
    writer = SupabaseWriter()
    try:
        project = _project_response(writer, project_id)
        query = _discovery_query(project)
        _set_project_run_stage(writer, run_id, "signal_collection")
        limit_per_source = int(payload.get("limit_per_source") or 10)
        media_items = collect_public_media(
            CollectorConfig(
                query=query,
                limit_per_source=limit_per_source,
                github_token=os.environ.get("GITHUB_TOKEN"),
            )
        )
        seed_topics = synthesize_seed_topics(media_items, max_topics=5)
        signals = synthesize_signals(media_items)
        opportunities = synthesize_opportunities(media_items, signals, max_opportunities=8)
        if not signals or not opportunities:
            fallback_query = _fallback_discovery_query(project)
            media_items = collect_public_media(
                CollectorConfig(
                    query=fallback_query,
                    limit_per_source=max(5, limit_per_source),
                    github_token=os.environ.get("GITHUB_TOKEN"),
                )
            )
            seed_topics = synthesize_seed_topics(media_items, max_topics=5)
            signals = synthesize_signals(media_items)
            opportunities = synthesize_opportunities(media_items, signals, max_opportunities=8)
            query = fallback_query
        source_result = SourceCollectionResult(
            query=query,
            media_items=media_items,
            seed_topics=seed_topics,
            signals=signals,
            opportunities=opportunities,
        )
        source_summary = writer.save_source_collection(source_result, project_id=project_id)

        research_summary: dict[str, Any] | None = None
        if os.environ.get("FORGE_ENABLE_DEEP_RESEARCH", "0") == "1" and media_items:
            research_agent = os.environ.get("FORGE_RESEARCH_AGENT", "antigravity")
            research_agent = "deep-research" if research_agent == "deep-research" else "antigravity"
            try:
                topic = seed_topics[0].topic if seed_topics else query
                client = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY"))
                research_raw = client.run_research_analyst(
                    topic,
                    media_items=media_items[:8],
                    agents_dir=AGENTS_DIR,
                    agent=research_agent,
                    timeout_seconds=int(os.environ.get("FORGE_DEEP_RESEARCH_TIMEOUT_SECONDS", "120")),
                )
                from .extract import extract_json_object, extract_json_payload

                research_payload = extract_json_payload(research_raw)
                raw_research_payload = extract_json_object(
                    research_raw,
                    required_any=("research_findings", "signals", "opportunities"),
                )
                if "research_findings" in raw_research_payload:
                    research_payload["research_findings"] = raw_research_payload["research_findings"]
                trend_research = TrendResearchPipelineResult.from_payloads(
                    topic=topic,
                    trend_payload={"media_items": [item.to_metadata() for item in media_items[:8]]},
                    trend_raw_text="project source collection",
                    trend_agent="public_collectors",
                    research_payload=research_payload,
                    research_raw_text=research_raw,
                    research_agent=research_agent,
                )
                research_summary = writer.save_trend_research(trend_research, project_id=project_id)
            except Exception as exc:  # managed-agent quota/latency should not kill discovery
                research_summary = {
                    "status": "failed_non_blocking",
                    "agent": research_agent,
                    "error": str(exc),
                }
        else:
            research_summary = {
                "status": "local_source_research",
                "agent": "deterministic_public_collectors",
                "media_items": len(media_items),
                "signals": len(signals),
                "opportunities": len(opportunities),
            }

        _set_project_run_stage(writer, run_id, "opportunity_clustering")
        records, signals_by_id = writer.fetch_opportunity_records(limit=100)
        records = [record for record in records if record.project_id == project_id]
        clusters = cluster_opportunities(records, signals_by_id, max_clusters=3)
        cluster_summary = writer.save_opportunity_clusters(clusters, project_id=project_id)

        eval_summary: dict[str, Any] | None = None
        if clusters and os.environ.get("FORGE_ENABLE_MANAGED_EVAL", "0") == "1":
            _set_project_run_stage(writer, run_id, "bull_bear")
            try:
                if os.environ.get("FORGE_FORCE_LOCAL_EVAL") == "1":
                    raise RuntimeError("Managed evaluation disabled by FORGE_FORCE_LOCAL_EVAL.")
                evaluation = _run_managed_evaluation(clusters[0], AGENTS_DIR)
            except Exception as exc:
                evaluation = _fallback_bull_bear_evaluation(clusters[0], exc)
            eval_summary = writer.save_bull_bear_evaluation(evaluation, project_id=project_id)
            writer.update(
                "opportunities",
                f"id=eq.{clusters[0].representative_opportunity_id}",
                {"status": "recommended", "updated_at": _now()},
            )
            _set_project_run_stage(writer, run_id, "synthesis")
        elif clusters:
            fallback_eval_summaries = []
            for cluster in clusters:
                evaluation = _fallback_bull_bear_evaluation(
                    cluster,
                    RuntimeError("Managed evaluation disabled for fast pipeline."),
                )
                fallback_eval_summaries.append(
                    writer.save_bull_bear_evaluation(evaluation, project_id=project_id)
                )
                writer.update(
                    "opportunities",
                    f"id=eq.{cluster.representative_opportunity_id}",
                    {"status": "recommended", "updated_at": _now()},
                )
            eval_summary = {
                "status": "local_fallback",
                "evaluations": fallback_eval_summaries,
            }

        summary = (
            f"Collected {len(media_items)} media items, created {len(opportunities)} opportunities, "
            f"and clustered {len(clusters)} candidates."
        )
        _complete_project_run(
            writer,
            run_id,
            "ready",
            summary,
            metadata={
                "source_collection": source_summary,
                "deep_research": research_summary,
                "opportunity_clustering": cluster_summary,
                "bull_bear": eval_summary,
            },
        )
    except Exception as exc:  # pragma: no cover
        _fail_project_run(writer, run_id, exc)


def _background_build(build_id: str) -> None:
    writer = SupabaseWriter()
    try:
        build = _expect_one(writer.select("mvp_builds", f"select=*&id=eq.{build_id}"), "build")
        writer.update("mvp_builds", f"id=eq.{build_id}", {"stage": "building"})
        if os.environ.get("FORGE_ENABLE_MANAGED_BUILDER") == "1":
            report = _run_managed_builder(build)
        else:
            report = _simulated_builder_report(build)
        if not report.get("pr_url"):
            raise RuntimeError("Managed builder did not return a pull request URL.")

        updated = _expect_one(
            writer.update(
                "mvp_builds",
                f"id=eq.{build_id}",
                {
                    "status": "completed",
                    "stage": "completed",
                    "summary": report.get("summary"),
                    "branch_name": report.get("branch_name"),
                    "pr_url": report.get("pr_url"),
                    "preview_url": report.get("preview_url"),
                    "completed_at": _now(),
                },
            ),
            "build",
        )
        writer.update(
            "opportunities",
            f"id=eq.{build['opportunity_id']}",
            {"status": "built", "updated_at": _now()},
        )
        return updated
    except Exception as exc:  # pragma: no cover
        writer.update(
            "mvp_builds",
            f"id=eq.{build_id}",
            {"status": "failed", "stage": "failed", "error": str(exc), "completed_at": _now()},
        )


def _run_managed_builder(build: dict[str, Any]) -> dict[str, Any]:
    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY is required when FORGE_ENABLE_MANAGED_BUILDER=1")
    raw = ManagedAgentClient(api_key=os.environ.get("GEMINI_API_KEY")).run_builder_agent(
        build.get("prompt_context") or {}
    )
    return _parse_builder_report(raw)


def _simulated_builder_report(build: dict[str, Any]) -> dict[str, Any]:
    repo_url = build.get("repo_url") or "https://github.com/forge-labs/generated-mvp"
    return {
        "generated_repo_url": repo_url,
        "branch_name": f"forge/build-{build['id'][:8]}",
        "pr_url": f"{repo_url.rstrip('/')}/pull/1",
        "preview_url": None,
        "summary": (
            "Managed builder prompt prepared and simulated PR metadata recorded. "
            "Set FORGE_ENABLE_MANAGED_BUILDER=1 to launch Gemini Antigravity."
        ),
        "artifacts": [
            {"type": "readme", "content": "Simulated README contract satisfied."},
            {"type": "test_result", "content": "Simulated smoke checks passed."},
            {"type": "service_manifest", "content": "No external services used."},
        ],
    }


def _parse_builder_report(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        value = json.loads(_extract_json_object(raw))

    if isinstance(value, dict) and isinstance(value.get("pr_url"), str):
        return value
    if isinstance(value, dict):
        output_text = _extract_interaction_text(value)
        if output_text:
            return json.loads(_extract_json_object(output_text))
    raise ValueError("Builder output did not include PR metadata JSON.")


def _extract_interaction_text(value: dict[str, Any]) -> str:
    if isinstance(value.get("output_text"), str):
        return value["output_text"]
    outputs = value.get("outputs")
    if not isinstance(outputs, list):
        return ""
    parts = []
    for output in outputs:
        if isinstance(output, dict) and isinstance(output.get("text"), str):
            parts.append(output["text"])
    return "\n".join(parts)


def _extract_json_object(raw: str) -> str:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return raw[start : end + 1]
    raise ValueError("No JSON object found in builder output.")


def _fallback_bull_bear_evaluation(cluster, exc: Exception) -> BullBearEvaluation:
    return BullBearEvaluation(
        cluster=cluster,
        bull={
            "position": "bull",
            "summary": (
                f"{cluster.canonical_title} has enough linked public evidence to prototype. "
                "The MVP is narrow and can be validated without paid services."
            ),
            "why_real_pain": [cluster.problem],
            "why_now": ["Developers are moving AI agent workflows from demos into production."],
            "adoption_case": ["A local tool can be tried without replacing the user's stack."],
            "smallest_convincing_mvp": cluster.mvp_concept,
            "supporting_evidence_urls": [signal.url for signal in cluster.evidence if signal.url][:5],
            "confidence": min(0.75, cluster.score),
            "risks_to_watch": ["Managed evaluation was unavailable; human review should treat this as provisional."],
        },
        bear={
            "position": "bear",
            "summary": (
                "The evidence is directional rather than conclusive, and the opportunity may overlap "
                "with existing developer tooling."
            ),
            "why_might_be_noise": ["Public-source signals may overrepresent vocal developer pain."],
            "adoption_risks": ["The MVP must avoid becoming a generic platform."],
            "existing_alternatives": ["Manual scripts", "framework-specific tooling", "observability dashboards"],
            "scope_traps": ["Supporting too many agent frameworks in the first prototype."],
            "missing_evidence": ["Direct user interviews", "competitive pricing evidence"],
            "confidence": 0.62,
        },
        decision={
            "recommendation": "prototype",
            "summary": "Proceed with a narrow prototype, but label this as fallback-evaluated.",
            "confidence": min(0.72, cluster.score),
            "required_mvp_constraints": ["Local-first", "No paid APIs", "README and smoke test required"],
            "next_action": "Prepare a build prompt for a tightly scoped prototype.",
            "approval_needed": True,
            "evidence_gaps": ["Managed Bull/Bear evaluation failed and should be rerun when quota is available."],
        },
        synthesis={
            "product_pitch": (
                f"{cluster.canonical_title} helps {cluster.target_user} address: {cluster.problem} "
                f"The first MVP is: {cluster.mvp_concept}"
            ),
            "target_user": cluster.target_user,
            "mvp_scope": [cluster.mvp_concept],
            "non_goals": ["Production deployment", "Paid API integrations", "Broad platform support"],
            "builder_system_prompt": (
                f"Build a local runnable prototype for {cluster.canonical_title}. "
                f"Problem: {cluster.problem}. MVP: {cluster.mvp_concept}. "
                "Use free/local dependencies only. Include README, setup/run instructions, and one smoke test."
            ),
            "builder_readiness": "ready",
            "confidence": min(0.72, cluster.score),
        },
        raw_outputs={"managed_error": str(exc)},
    )


def _project_response(writer: SupabaseWriter, project_id: str) -> dict[str, Any]:
    project = _expect_one(writer.select("projects", f"select=*&id=eq.{project_id}"), "project")
    schedules = writer.select("project_schedules", f"select=*&project_id=eq.{project_id}&limit=1")
    runs = writer.select("project_runs", f"select=*&project_id=eq.{project_id}&order=started_at.desc&limit=1")
    return {
        "id": project["id"],
        "name": project["name"],
        "mode": project["mode"],
        "repo_url": project.get("repo_url"),
        "description": project.get("description") or "",
        "product_context": project.get("product_context"),
        "schedule": _schedule_response(schedules[0]) if schedules else None,
        "latest_run": _run_response(runs[0]) if runs else None,
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
    }


def _schedule_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "enabled": row["enabled"],
        "cron": row["cron"],
        "timezone": row["timezone"],
        "next_run_at": row.get("next_run_at"),
    }


def _run_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "status": row["status"],
        "stage": row["stage"],
        "trigger": row["trigger"],
        "started_at": row["started_at"],
        "completed_at": row.get("completed_at"),
        "error": row.get("error"),
        "summary": row.get("summary"),
    }


def _opportunity_card(writer: SupabaseWriter, row: dict[str, Any]) -> dict[str, Any]:
    evaluations = _evaluations_by_name(writer, row["id"])
    synthesis = evaluations.get("synthesizer_agent") or {}
    decision = evaluations.get("decision_agent") or {}
    evidence_count = len(writer.select("opportunity_signals", f"select=signal_id&opportunity_id=eq.{row['id']}"))
    confidence = _score_from(decision) or _score_from(synthesis) or float(row.get("score") or 0)
    return {
        "id": row["id"],
        "project_id": row.get("project_id"),
        "title": row["title"],
        "problem": row.get("problem") or "",
        "target_user": row.get("target_user") or "",
        "mvp_concept": row.get("mvp_concept") or "",
        "confidence": confidence,
        "status": row.get("status") or "recommended",
        "evidence_count": evidence_count,
        "synthesized_pitch": synthesis.get("product_pitch"),
        "builder_readiness": synthesis.get("builder_readiness"),
        "latest_evaluation_run_id": (synthesis.get("scores") or {}).get("cluster_run_id"),
        "created_at": row["created_at"],
    }


def _opportunity_detail(writer: SupabaseWriter, row: dict[str, Any]) -> dict[str, Any]:
    card = _opportunity_card(writer, row)
    evaluations = _evaluations_by_name(writer, row["id"])
    signals = _linked_signals(writer, row["id"])
    latest_action = writer.select(
        "opportunity_actions",
        f"select=*&opportunity_id=eq.{row['id']}&order=created_at.desc&limit=1",
    )
    return {
        **card,
        "evidence_summary": {
            "signal_count": len(signals),
            "top_sources": sorted({signal.get("source") for signal in signals if signal.get("source")})[:5],
            "research_summary": _research_summary(signals),
        },
        "bull_case": _bull_case(evaluations.get("bull_agent")),
        "bear_case": _bear_case(evaluations.get("bear_agent")),
        "decision": _decision_case(evaluations.get("decision_agent")),
        "synthesis": _synthesis_case(evaluations.get("synthesizer_agent")),
        "user_notes": latest_action[0].get("user_notes") if latest_action else None,
    }


def _build_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "opportunity_id": row["opportunity_id"],
        "status": row["status"],
        "stage": row["stage"],
        "repo_url": row["repo_url"],
        "branch_name": row.get("branch_name"),
        "pr_url": row.get("pr_url"),
        "preview_url": row.get("preview_url"),
        "summary": row.get("summary"),
        "error": row.get("error"),
        "started_at": row["started_at"],
        "completed_at": row.get("completed_at"),
    }


def _create_project_run(writer: SupabaseWriter, project_id: str, trigger: str, stage: str) -> dict[str, Any]:
    return writer.insert(
        "project_runs",
        [
            {
                "project_id": project_id,
                "status": "in_progress",
                "stage": stage,
                "trigger": trigger,
            }
        ],
    )[0]


def _set_project_run_stage(writer: SupabaseWriter, run_id: str, stage: str) -> None:
    if stage not in PIPELINE_STAGES:
        raise ValueError(f"Invalid stage: {stage}")
    writer.update("project_runs", f"id=eq.{run_id}", {"status": "in_progress", "stage": stage})


def _complete_project_run(
    writer: SupabaseWriter,
    run_id: str,
    stage: str,
    summary: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    writer.update(
        "project_runs",
        f"id=eq.{run_id}",
        {
            "status": "completed",
            "stage": stage,
            "summary": summary,
            "metadata": metadata or {},
            "completed_at": _now(),
        },
    )


def _fail_project_run(writer: SupabaseWriter, run_id: str, exc: Exception) -> None:
    writer.update(
        "project_runs",
        f"id=eq.{run_id}",
        {
            "status": "failed",
            "stage": "failed",
            "error": str(exc),
            "completed_at": _now(),
        },
    )


def _evaluations_by_name(writer: SupabaseWriter, opportunity_id: str) -> dict[str, dict[str, Any]]:
    rows = writer.select(
        "opportunity_evaluations",
        f"select=*&opportunity_id=eq.{opportunity_id}&order=created_at.desc",
    )
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        evaluator = row.get("evaluator")
        if evaluator and evaluator not in result:
            scores = row.get("scores") or {}
            payload = scores.get("payload") if isinstance(scores, dict) else None
            parsed = dict(payload) if isinstance(payload, dict) else _parse_content(row.get("content"))
            parsed["scores"] = scores
            result[evaluator] = parsed
    return result


def _linked_signals(writer: SupabaseWriter, opportunity_id: str) -> list[dict[str, Any]]:
    links = writer.select("opportunity_signals", f"select=signal_id&opportunity_id=eq.{opportunity_id}")
    signal_ids = [link["signal_id"] for link in links if link.get("signal_id")]
    if not signal_ids:
        return []
    return writer.select("signals", f"select=*&id=in.({','.join(signal_ids)})")


def _bull_case(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    return {
        "summary": value.get("summary") or value.get("position") or "",
        "confidence": _score_from(value),
        "bullets": value.get("why_real_pain") or value.get("adoption_case") or [],
    }


def _bear_case(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    return {
        "summary": value.get("summary") or "",
        "confidence": _score_from(value),
        "risks": value.get("adoption_risks") or value.get("scope_traps") or [],
        "missing_evidence": value.get("missing_evidence") or [],
    }


def _decision_case(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    return {
        "recommendation": value.get("recommendation") or "watch",
        "summary": value.get("summary") or "",
        "confidence": _score_from(value),
        "required_constraints": value.get("required_mvp_constraints") or [],
    }


def _synthesis_case(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    return {
        "product_pitch": value.get("product_pitch") or "",
        "mvp_scope": value.get("mvp_scope") or [],
        "non_goals": value.get("non_goals") or [],
        "builder_system_prompt": value.get("builder_system_prompt") or "",
        "builder_readiness": value.get("builder_readiness") or "not_ready",
    }


def _build_prompt_context(project: dict[str, Any], opportunity: dict[str, Any], user_notes: str | None) -> dict[str, Any]:
    return {
        "user_notes": user_notes,
        "saved_user_notes": opportunity.get("user_notes"),
        "builder_system_prompt": (opportunity.get("synthesis") or {}).get("builder_system_prompt"),
        "project": project,
        "opportunity": {
            "id": opportunity["id"],
            "title": opportunity["title"],
            "problem": opportunity["problem"],
            "mvp_concept": opportunity["mvp_concept"],
        },
        "generated_pr_contract": {
            "requires_readme": True,
            "requires_smoke_test": True,
            "no_paid_apis": True,
            "no_production_deploy": True,
        },
    }


def _parse_content(content: str | None) -> dict[str, Any]:
    if not content:
        return {}
    # Older rows stored summary text only. Keep those compatible with the contract.
    return {"summary": content}


def _score_from(value: dict[str, Any] | None) -> float:
    if not value:
        return 0.0
    for key in ("confidence", "score", "overall"):
        try:
            return max(0.0, min(1.0, float(value.get(key))))
        except (TypeError, ValueError):
            continue
    scores = value.get("scores") if isinstance(value.get("scores"), dict) else {}
    try:
        return max(0.0, min(1.0, float(scores.get("overall"))))
    except (TypeError, ValueError):
        return 0.0


def _research_summary(signals: list[dict[str, Any]]) -> str:
    titles = [signal.get("title") for signal in signals[:3] if signal.get("title")]
    if not titles:
        return "No linked evidence found."
    return "Top linked evidence: " + "; ".join(titles)


def _discovery_query(project: dict[str, Any]) -> str:
    parts = [
        project.get("name"),
        project.get("description"),
        project.get("product_context"),
        "developer pain market signals GitHub issues",
    ]
    return " ".join(str(part) for part in parts if part)[:300]


def _fallback_discovery_query(project: dict[str, Any]) -> str:
    return "AI agents developer tools production pain testing observability cost security GitHub issues"


def _default_project_name(payload: dict[str, Any]) -> str:
    description = str(payload.get("description") or "Untitled Forge Project").strip()
    return description[:48] or "Untitled Forge Project"


def _expect_one(rows: list[dict[str, Any]], label: str) -> dict[str, Any]:
    if not rows:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return rows[0]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
