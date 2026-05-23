"""Public source clients for social trends and repositories."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .config import get_settings
from .http import build_url, get_json
from .models import Signal


def _timestamp_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return str(value)


def fetch_hacker_news_trends(keywords: list[str], max_items: int = 20) -> list[Signal]:
    """Fetch Hacker News posts and comments matching the supplied keywords."""
    query = " OR ".join(keyword.strip() for keyword in keywords if keyword.strip())
    if not query:
        return []
    url = build_url(
        "https://hn.algolia.com/api/v1/search_by_date",
        {"query": query, "tags": "story,comment", "hitsPerPage": max_items},
    )
    data = get_json(url)
    if "error" in data:
        return []

    signals: list[Signal] = []
    for hit in data.get("hits", [])[:max_items]:
        title = hit.get("title") or hit.get("story_title") or hit.get("comment_text") or "Hacker News signal"
        body = hit.get("comment_text") or hit.get("story_text") or ""
        object_id = hit.get("objectID")
        item_url = hit.get("url") or (
            f"https://news.ycombinator.com/item?id={object_id}" if object_id else None
        )
        signals.append(
            Signal(
                source="hacker_news",
                source_id=object_id,
                url=item_url,
                title=str(title),
                body=str(body),
                author=hit.get("author"),
                published_at=hit.get("created_at"),
                tags=["social", "hacker_news", *keywords],
                metadata={"points": hit.get("points"), "num_comments": hit.get("num_comments")},
            )
        )
    return signals


def fetch_reddit_trends(subreddits: list[str], keywords: list[str], max_items: int = 20) -> list[Signal]:
    """Fetch recent public Reddit posts from selected subreddits."""
    signals: list[Signal] = []
    per_subreddit = max(1, min(max_items, 25))
    keyword_text = " ".join(keyword.lower() for keyword in keywords)

    for subreddit in [item.strip().strip("r/") for item in subreddits if item.strip()]:
        url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={per_subreddit}"
        data = get_json(url, headers={"User-Agent": "ForgeIngestionAgent/0.1"})
        if "error" in data:
            continue
        for child in data.get("data", {}).get("children", []):
            post = child.get("data", {})
            title = str(post.get("title") or "Reddit signal")
            body = str(post.get("selftext") or "")
            haystack = f"{title} {body}".lower()
            if keyword_text and not any(keyword.lower() in haystack for keyword in keywords):
                continue
            permalink = post.get("permalink")
            signals.append(
                Signal(
                    source="reddit",
                    source_id=post.get("id"),
                    url=f"https://www.reddit.com{permalink}" if permalink else None,
                    title=title,
                    body=body,
                    author=post.get("author"),
                    published_at=_timestamp_to_iso(post.get("created_utc")),
                    tags=["social", "reddit", subreddit, *keywords],
                    metadata={
                        "subreddit": subreddit,
                        "score": post.get("score"),
                        "num_comments": post.get("num_comments"),
                    },
                )
            )
            if len(signals) >= max_items:
                return signals
    return signals


def fetch_github_repo_trends(keywords: list[str], max_items: int = 20) -> list[Signal]:
    """Search GitHub repositories for trend and pain signals."""
    query = " ".join(keyword.strip() for keyword in keywords if keyword.strip())
    if not query:
        return []

    settings = get_settings()
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ForgeIngestionAgent/0.1",
    }
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    url = build_url(
        "https://api.github.com/search/repositories",
        {"q": query, "sort": "updated", "order": "desc", "per_page": max_items},
    )
    data = get_json(url, headers=headers)
    if "error" in data:
        return []

    signals: list[Signal] = []
    for repo in data.get("items", [])[:max_items]:
        signals.append(
            Signal(
                source="github_repo",
                source_id=str(repo.get("id")) if repo.get("id") is not None else None,
                url=repo.get("html_url"),
                title=repo.get("full_name") or repo.get("name") or "GitHub repository",
                body=repo.get("description") or "",
                author=repo.get("owner", {}).get("login"),
                published_at=repo.get("updated_at"),
                tags=["repo", "github", *keywords, *(repo.get("topics") or [])],
                metadata={
                    "stars": repo.get("stargazers_count"),
                    "forks": repo.get("forks_count"),
                    "open_issues": repo.get("open_issues_count"),
                    "language": repo.get("language"),
                },
            )
        )
    return signals

