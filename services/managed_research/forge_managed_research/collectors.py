"""Cheap public-source collectors for Forge media ingestion."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import MediaItem


USER_AGENT = "ForgeManagedResearch/0.1"


@dataclass
class CollectorConfig:
    query: str
    limit_per_source: int = 10
    github_token: str | None = None
    reddit_subreddits: tuple[str, ...] = ()


def collect_public_media(config: CollectorConfig) -> list[MediaItem]:
    """Collect public media from cheap deterministic sources."""
    collectors = [
        collect_hacker_news,
        collect_reddit,
        collect_github_issues,
    ]
    items: list[MediaItem] = []
    seen_urls: set[str] = set()
    for collector in collectors:
        try:
            for item in collector(config):
                key = item.url or f"{item.source}:{item.title}"
                if key in seen_urls:
                    continue
                seen_urls.add(key)
                items.append(item)
        except Exception as exc:  # pragma: no cover - network variance
            items.append(
                MediaItem(
                    source="collector_error",
                    title=f"{collector.__name__} failed",
                    summary=str(exc),
                    tags=["collector_error"],
                    metadata={"collector": collector.__name__, "error": str(exc)},
                )
            )
    return items


def collect_hacker_news(config: CollectorConfig) -> list[MediaItem]:
    query = urlencode({"query": config.query, "hitsPerPage": config.limit_per_source})
    url = f"https://hn.algolia.com/api/v1/search_by_date?{query}"
    payload = _get_json(url)
    items: list[MediaItem] = []
    for hit in payload.get("hits", [])[: config.limit_per_source]:
        title = hit.get("title") or hit.get("story_title") or "Untitled Hacker News item"
        item_url = hit.get("url") or (
            f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
            if hit.get("objectID")
            else None
        )
        text = hit.get("comment_text") or hit.get("story_text") or ""
        summary = _compact_text(text) or title
        items.append(
            MediaItem(
                source="hacker_news",
                title=str(title),
                url=item_url,
                summary=summary,
                captured_text=summary,
                published_at=hit.get("created_at"),
                tags=["hacker_news", *_query_tags(config.query)],
                metadata={
                    "object_id": hit.get("objectID"),
                    "author": hit.get("author"),
                    "points": hit.get("points"),
                    "num_comments": hit.get("num_comments"),
                    "content_type": "discussion",
                },
            )
        )
    return items


def collect_reddit(config: CollectorConfig) -> list[MediaItem]:
    """Search public Reddit JSON for recent posts matching the project query."""
    items: list[MediaItem] = []
    subreddits = [item.strip().strip("r/") for item in config.reddit_subreddits if item.strip()]
    targets: list[str | None] = subreddits or [None]
    per_target_limit = max(1, config.limit_per_source)
    for subreddit in targets:
        params = {
            "q": config.query,
            "sort": "new",
            "limit": per_target_limit,
            "type": "link",
        }
        if subreddit:
            params["restrict_sr"] = "1"
        path = f"https://www.reddit.com/r/{subreddit}/search.json" if subreddit else "https://www.reddit.com/search.json"
        payload = _get_json(f"{path}?{urlencode(params)}")
        children = payload.get("data", {}).get("children", [])
        for child in children:
            if not isinstance(child, dict):
                continue
            post = child.get("data") if isinstance(child.get("data"), dict) else {}
            title = str(post.get("title") or "Untitled Reddit post")
            selftext = str(post.get("selftext") or "")
            summary = _compact_text(selftext) or title
            permalink = post.get("permalink")
            post_subreddit = str(post.get("subreddit") or subreddit or "")
            created_utc = post.get("created_utc")
            published_at = None
            if isinstance(created_utc, (int, float)):
                published_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created_utc))
            items.append(
                MediaItem(
                    source="reddit",
                    title=title,
                    url=f"https://www.reddit.com{permalink}" if permalink else post.get("url"),
                    summary=summary,
                    captured_text=summary,
                    published_at=published_at,
                    tags=["reddit", post_subreddit, *_query_tags(config.query)],
                    metadata={
                        "subreddit": post_subreddit,
                        "author": post.get("author"),
                        "score": post.get("score"),
                        "num_comments": post.get("num_comments"),
                        "content_type": "discussion",
                        "reddit_id": post.get("id"),
                        "source_query": config.query,
                    },
                )
            )
            if len(items) >= config.limit_per_source:
                return items
    return items


def collect_github_issues(config: CollectorConfig) -> list[MediaItem]:
    query = urlencode(
        {
            "q": f"{config.query} in:title,body type:issue",
            "sort": "updated",
            "order": "desc",
            "per_page": config.limit_per_source,
        }
    )
    url = f"https://api.github.com/search/issues?{query}"
    headers = {}
    token = config.github_token or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = _get_json(url, headers=headers)
    items: list[MediaItem] = []
    for issue in payload.get("items", [])[: config.limit_per_source]:
        body = issue.get("body") or ""
        summary = _compact_text(body) or str(issue.get("title") or "Untitled GitHub issue")
        labels = [
            str(label.get("name"))
            for label in issue.get("labels", [])
            if isinstance(label, dict) and label.get("name")
        ]
        items.append(
            MediaItem(
                source="github",
                title=str(issue.get("title") or "Untitled GitHub issue"),
                url=issue.get("html_url"),
                summary=summary,
                captured_text=summary,
                published_at=issue.get("updated_at") or issue.get("created_at"),
                tags=["github_issue", *_query_tags(config.query), *labels[:5]],
                metadata={
                    "repository_url": issue.get("repository_url"),
                    "state": issue.get("state"),
                    "comments": issue.get("comments"),
                    "content_type": "issue",
                },
            )
        )
    return items


def _get_json(url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urlopen(request, timeout=30) as response:
        if "api.github.com" in url:
            remaining = response.headers.get("X-RateLimit-Remaining")
            reset = response.headers.get("X-RateLimit-Reset")
            if remaining == "0" and reset and reset.isdigit():
                wait_seconds = max(0, int(reset) - int(time.time()))
                raise RuntimeError(f"GitHub rate limit exhausted; resets in {wait_seconds}s")
        return json.loads(response.read().decode("utf-8"))


def _compact_text(value: str, limit: int = 700) -> str:
    text = " ".join(str(value).replace("\n", " ").split())
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _query_tags(query: str) -> list[str]:
    tags = []
    for word in query.lower().replace("-", " ").split():
        cleaned = "".join(ch for ch in word if ch.isalnum() or ch == "_")
        if len(cleaned) >= 4 and cleaned not in tags:
            tags.append(cleaned)
    return tags[:5]
