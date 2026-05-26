from forge_managed_research import collectors
from forge_managed_research.collectors import (
    CollectorConfig,
    collect_public_media,
    collect_github_issues,
    collect_reddit,
    collect_stack_exchange,
    github_token_from_env,
    redact_sensitive_text,
    source_plan_routing,
)


def test_collect_reddit_parses_public_search_json():
    def fake_get_json(url, headers=None):
        assert "reddit.com/search.json" in url
        assert "agent+evals" in url
        return {
            "data": {
                "children": [
                    {
                        "data": {
                            "id": "abc123",
                            "title": "Agent evals are hard to debug",
                            "selftext": "I cannot tell why my tool-calling eval failed.",
                            "permalink": "/r/LocalLLaMA/comments/abc123/agent_evals/",
                            "subreddit": "LocalLLaMA",
                            "author": "builder",
                            "score": 42,
                            "num_comments": 7,
                            "created_utc": 1_700_000_000,
                        }
                    }
                ]
            }
        }

    original_get_json = collectors._get_json
    collectors._get_json = fake_get_json
    try:
        items = collect_reddit(CollectorConfig(query="agent evals", limit_per_source=5))
    finally:
        collectors._get_json = original_get_json

    assert len(items) == 1
    assert items[0].source == "reddit"
    assert items[0].url == "https://www.reddit.com/r/LocalLLaMA/comments/abc123/agent_evals/"
    assert items[0].metadata["subreddit"] == "LocalLLaMA"
    assert items[0].metadata["reddit_id"] == "abc123"


def test_collect_github_issues_uses_only_explicit_config_token():
    captured_headers = []

    def fake_get_json(url, headers=None):
        assert "api.github.com/search/issues" in url
        captured_headers.append(headers or {})
        return {"items": []}

    original_get_json = collectors._get_json
    collectors._get_json = fake_get_json
    try:
        collect_github_issues(CollectorConfig(query="agent evals", limit_per_source=2))
        collect_github_issues(
            CollectorConfig(query="agent evals", limit_per_source=2, github_token="short_lived_token")
        )
    finally:
        collectors._get_json = original_get_json

    assert "Authorization" not in captured_headers[0]
    assert captured_headers[1]["Authorization"] == "Bearer short_lived_token"


def test_source_plan_routing_extracts_explicit_sources_and_targets():
    routing = source_plan_routing(
        [
            "GitHub issues in agent framework repos",
            "Reddit r/LocalLLaMA and r/codex posts",
            "Stack Overflow questions from developers",
        ],
        default_reddit_subreddits=("OpenAI",),
        default_stack_exchange_sites=("superuser",),
    )

    assert routing.enabled_sources == ("reddit", "stack_exchange", "github")
    assert routing.reddit_subreddits == ("OpenAI", "LocalLLaMA", "codex")
    assert routing.stack_exchange_sites == ("superuser", "stackoverflow")
    assert routing.query_hints[0] == "GitHub issues in agent framework repos"


def test_source_plan_routing_keeps_broad_collectors_for_generic_communities():
    routing = source_plan_routing(["public founder communities"])

    assert routing.enabled_sources == ("hacker_news", "reddit", "stack_exchange", "github")


def test_source_plan_routing_keeps_discussion_collectors_when_mixed_with_github():
    routing = source_plan_routing(["Public developer discussions", "GitHub issues"])

    assert routing.enabled_sources == ("hacker_news", "reddit", "stack_exchange", "github")


def test_collect_public_media_respects_source_plan_enabled_sources():
    calls = []

    original_hacker_news = collectors.collect_hacker_news
    original_reddit = collectors.collect_reddit
    original_stack_exchange = collectors.collect_stack_exchange
    original_collectors = collectors.collect_github_issues
    collectors.collect_hacker_news = lambda config: calls.append("hacker_news") or []
    collectors.collect_reddit = lambda config: calls.append("reddit") or []
    collectors.collect_stack_exchange = lambda config: calls.append("stack_exchange") or []
    collectors.collect_github_issues = lambda config: calls.append("github") or []
    try:
        collect_public_media(
            CollectorConfig(
                query="agent evals",
                enabled_sources=("github",),
                source_plan=("GitHub issues",),
            )
        )
    finally:
        collectors.collect_hacker_news = original_hacker_news
        collectors.collect_reddit = original_reddit
        collectors.collect_stack_exchange = original_stack_exchange
        collectors.collect_github_issues = original_collectors

    assert calls == ["github"]


def test_collect_stack_exchange_parses_advanced_search_questions():
    def fake_get_json(url, headers=None):
        assert "api.stackexchange.com/2.3/search/advanced" in url
        assert "site=stackoverflow" in url
        assert "filter=withbody" in url
        assert "agent+evals" in url
        return {
            "items": [
                {
                    "question_id": 123,
                    "title": "How do I debug agent eval failures?",
                    "link": "https://stackoverflow.com/questions/123/debug-agent-evals",
                    "body": "<p>I cannot tell why my tool-calling eval failed.</p>",
                    "tags": ["evaluation", "agents"],
                    "owner": {"display_name": "builder"},
                    "score": 8,
                    "answer_count": 2,
                    "view_count": 140,
                    "is_answered": True,
                    "last_activity_date": 1_700_000_000,
                }
            ]
        }

    original_get_json = collectors._get_json
    collectors._get_json = fake_get_json
    try:
        items = collect_stack_exchange(CollectorConfig(query="agent evals", limit_per_source=5))
    finally:
        collectors._get_json = original_get_json

    assert len(items) == 1
    assert items[0].source == "stack_exchange"
    assert items[0].url == "https://stackoverflow.com/questions/123/debug-agent-evals"
    assert items[0].summary == "I cannot tell why my tool-calling eval failed."
    assert items[0].metadata["site"] == "stackoverflow"
    assert items[0].metadata["question_id"] == 123
    assert items[0].metadata["answer_count"] == 2


def test_github_token_from_env_requires_explicit_local_fallback():
    env = {
        "GITHUB_TOKEN": "broad_token",
        "FORGE_GITHUB_TOKEN": "forge_token",
    }

    assert github_token_from_env(env) is None
    assert github_token_from_env({**env, "FORGE_ALLOW_GITHUB_TOKEN_FALLBACK": "1"}) == "forge_token"
    assert (
        github_token_from_env(
            {**env, "FORGE_ALLOW_GITHUB_TOKEN_FALLBACK": "1", "FORGE_REQUIRE_AUTH": "1"}
        )
        is None
    )


def test_collect_public_media_redacts_collector_error_tokens():
    def fake_collect_github_issues(config):
        raise RuntimeError(
            f"Authorization: Bearer {config.github_token}; github_access_token={config.github_token}"
        )

    original_hacker_news = collectors.collect_hacker_news
    original_reddit = collectors.collect_reddit
    original_stack_exchange = collectors.collect_stack_exchange
    original_collectors = collectors.collect_github_issues
    collectors.collect_hacker_news = lambda config: []
    collectors.collect_reddit = lambda config: []
    collectors.collect_stack_exchange = lambda config: []
    collectors.collect_github_issues = fake_collect_github_issues
    try:
        items = collect_public_media(
            CollectorConfig(query="agent evals", limit_per_source=1, github_token="short_lived_token")
        )
    finally:
        collectors.collect_hacker_news = original_hacker_news
        collectors.collect_reddit = original_reddit
        collectors.collect_stack_exchange = original_stack_exchange
        collectors.collect_github_issues = original_collectors

    errors = [item for item in items if item.source == "collector_error"]
    assert errors
    assert "short_lived_token" not in errors[-1].summary
    assert "short_lived_token" not in errors[-1].metadata["error"]
    assert "[REDACTED]" in errors[-1].summary


def test_redact_sensitive_text_handles_common_token_shapes():
    text = (
        "Authorization: Bearer abc123 "
        "github_access_token=ghs_token "
        "access_token: ghu_token "
        "literal"
    )

    redacted = redact_sensitive_text(text, "literal")

    assert "abc123" not in redacted
    assert "ghs_token" not in redacted
    assert "ghu_token" not in redacted
    assert "literal" not in redacted
