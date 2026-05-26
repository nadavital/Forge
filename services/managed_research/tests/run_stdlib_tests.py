"""Minimal stdlib test runner for environments without pytest."""

from __future__ import annotations

import sys
import os
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(TESTS_DIR))
sys.path.insert(0, str(PACKAGE_DIR))
os.chdir(PACKAGE_DIR)

from test_extract import (  # noqa: E402
    test_extract_json_payload_from_fenced_block,
    test_extract_json_payload_returns_empty_contract_when_missing,
)
from test_api_contract import (  # noqa: E402
    test_builder_report_parses_fenced_json,
    test_build_prompt_context_prioritizes_user_notes,
    test_managed_research_auth_requires_bearer_secret,
    test_managed_research_requires_secret_unless_unauthenticated_mode_is_explicit,
    test_managed_research_prefers_request_scoped_github_token,
    test_research_brief_fallback_evaluation_preserves_user_context,
    test_research_brief_fallback_can_mark_evidence_ready_for_prototype,
    test_research_brief_payload_passes_source_plan_to_collector,
    test_research_brief_query_preserves_user_context,
    test_research_brief_source_plan_routes_collector_config,
    test_run_response_uses_contract_shape,
    test_simulated_builder_report_uses_target_repo,
    test_status_constants_match_frontend_contract,
)
from test_collectors import (  # noqa: E402
    test_collect_github_issues_uses_only_explicit_config_token,
    test_collect_public_media_redacts_collector_error_tokens,
    test_collect_public_media_respects_source_plan_enabled_sources,
    test_collect_reddit_parses_public_search_json,
    test_collect_stack_exchange_parses_advanced_search_questions,
    test_github_token_from_env_requires_explicit_local_fallback,
    test_redact_sensitive_text_handles_common_token_shapes,
    test_source_plan_routing_extracts_explicit_sources_and_targets,
    test_source_plan_routing_keeps_broad_collectors_for_generic_communities,
    test_source_plan_routing_keeps_discussion_collectors_when_mixed_with_github,
)
from test_local_synthesis import (  # noqa: E402
    test_brief_synthesis_accepts_dict_signals_from_stored_payloads,
    test_brief_synthesis_marks_multi_source_cited_evidence_build_ready,
    test_local_synthesis_creates_topics_signals_and_opportunities,
)
from test_opportunity_clustering import (  # noqa: E402
    test_bull_bear_fixture_parses_synthesis,
    test_cluster_opportunities_groups_duplicate_cost_ideas,
)
from test_trend_research import (  # noqa: E402
    test_seed_discovery_result_from_payload,
    test_trend_research_pipeline_result_from_payloads,
)
from test_supabase_writer import (  # noqa: E402
    test_managed_research_save_attaches_project_id_to_rows,
    test_seed_discovery_save_attaches_project_id_to_run,
)
from forge_managed_research.env import load_env_file  # noqa: E402


def main() -> None:
    test_extract_json_payload_from_fenced_block()
    test_extract_json_payload_returns_empty_contract_when_missing()
    test_status_constants_match_frontend_contract()
    test_run_response_uses_contract_shape()
    test_build_prompt_context_prioritizes_user_notes()
    test_builder_report_parses_fenced_json()
    test_simulated_builder_report_uses_target_repo()
    test_managed_research_auth_requires_bearer_secret()
    test_managed_research_requires_secret_unless_unauthenticated_mode_is_explicit()
    test_managed_research_prefers_request_scoped_github_token()
    test_research_brief_query_preserves_user_context()
    test_research_brief_source_plan_routes_collector_config()
    test_research_brief_payload_passes_source_plan_to_collector()
    test_research_brief_fallback_evaluation_preserves_user_context()
    test_research_brief_fallback_can_mark_evidence_ready_for_prototype()
    test_collect_reddit_parses_public_search_json()
    test_collect_stack_exchange_parses_advanced_search_questions()
    test_collect_github_issues_uses_only_explicit_config_token()
    test_source_plan_routing_extracts_explicit_sources_and_targets()
    test_source_plan_routing_keeps_broad_collectors_for_generic_communities()
    test_source_plan_routing_keeps_discussion_collectors_when_mixed_with_github()
    test_collect_public_media_respects_source_plan_enabled_sources()
    test_github_token_from_env_requires_explicit_local_fallback()
    test_collect_public_media_redacts_collector_error_tokens()
    test_redact_sensitive_text_handles_common_token_shapes()
    test_local_synthesis_creates_topics_signals_and_opportunities()
    test_brief_synthesis_accepts_dict_signals_from_stored_payloads()
    test_brief_synthesis_marks_multi_source_cited_evidence_build_ready()
    test_cluster_opportunities_groups_duplicate_cost_ideas()
    test_bull_bear_fixture_parses_synthesis()
    test_trend_research_pipeline_result_from_payloads()
    test_seed_discovery_result_from_payload()
    test_managed_research_save_attaches_project_id_to_rows()
    test_seed_discovery_save_attaches_project_id_to_run()
    load_env_file(Path("/tmp/forge-managed-research-missing.env"))
    print("stdlib tests passed")


if __name__ == "__main__":
    main()
