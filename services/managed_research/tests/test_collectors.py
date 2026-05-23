from forge_managed_research import collectors
from forge_managed_research.collectors import CollectorConfig, collect_reddit


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
