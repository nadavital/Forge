"""Cheap public-source collectors for Forge media ingestion."""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from html import unescape
from typing import Any, Mapping
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import MediaItem


USER_AGENT = "ForgeManagedResearch/0.1"
DEFAULT_COLLECTOR_SOURCES = ("hacker_news", "reddit", "stack_exchange", "github")


@dataclass
class CollectorConfig:
    query: str
    limit_per_source: int = 10
    github_token: str | None = None
    reddit_subreddits: tuple[str, ...] = ()
    stack_exchange_sites: tuple[str, ...] = ("stackoverflow",)
    enabled_sources: tuple[str, ...] = DEFAULT_COLLECTOR_SOURCES
    source_plan: tuple[str, ...] = ()
    query_hints: tuple[str, ...] = ()


@dataclass(frozen=True)
class SourcePlanRouting:
    enabled_sources: tuple[str, ...]
    reddit_subreddits: tuple[str, ...]
    stack_exchange_sites: tuple[str, ...]
    query_hints: tuple[str, ...]


def github_token_from_env(env: Mapping[str, str | None] = os.environ) -> str | None:
    """Return a broad GitHub token only when the local-dev fallback is explicit."""
    if str(env.get("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK") or "").lower() not in {"1", "true", "yes"}:
        return None
    if str(env.get("FORGE_REQUIRE_AUTH") or "").lower() in {"1", "true", "yes"}:
        return None
    return (env.get("FORGE_GITHUB_TOKEN") or env.get("GITHUB_TOKEN") or "").strip() or None


def collect_public_media(config: CollectorConfig) -> list[MediaItem]:
    """Collect public media from cheap deterministic sources."""
    collector_map = [
        ("hacker_news", collect_hacker_news),
        ("reddit", collect_reddit),
        ("stack_exchange", collect_stack_exchange),
        ("github", collect_github_issues),
    ]
    enabled = set(config.enabled_sources or DEFAULT_COLLECTOR_SOURCES)
    collectors = [
        (source, collector)
        for source, collector in collector_map
        if source in enabled
    ]
    items: list[MediaItem] = []
    seen_urls: set[str] = set()
    for source, collector in collectors:
        try:
            for item in collector(config):
                key = item.url or f"{item.source}:{item.title}"
                if key in seen_urls:
                    continue
                seen_urls.add(key)
                items.append(item)
        except Exception as exc:  # pragma: no cover - network variance
            error = redact_sensitive_text(str(exc), config.github_token)
            items.append(
                MediaItem(
                    source="collector_error",
                    title=f"{collector.__name__} failed",
                    summary=error,
                    tags=["collector_error"],
                    metadata={
                        "collector": collector.__name__,
                        "source": source,
                        "error": error,
                        **_source_plan_metadata(config),
                    },
                )
            )
    return items


def source_plan_routing(
    source_plan: list[str] | tuple[str, ...],
    *,
    default_reddit_subreddits: tuple[str, ...] = (),
    default_stack_exchange_sites: tuple[str, ...] = ("stackoverflow",),
) -> SourcePlanRouting:
    """Convert a user-approved source plan into deterministic collector targets."""
    plan_items = tuple(item for item in (_clean_plan_item(item) for item in source_plan) if item)
    text = " ".join(plan_items).lower()
    tokens = set(re.findall(r"[a-z0-9_]+", text))
    enabled: list[str] = []
    if "hn" in tokens or any(term in text for term in ("hacker news", "y combinator", "news.ycombinator")):
        enabled.append("hacker_news")
    if any(term in text for term in ("reddit", "subreddit", " r/")) or _extract_subreddits(plan_items):
        enabled.append("reddit")
    stack_terms = (
        "stack overflow",
        "stackoverflow",
        "stack exchange",
        "stackexchange",
        "server fault",
        "serverfault",
        "superuser",
    )
    if any(term in text for term in stack_terms):
        enabled.append("stack_exchange")
    if any(term in text for term in ("github", "git hub", "repo", "repository", "issue tracker", "issues")):
        enabled.append("github")
    if _mentions_public_discussions(text):
        enabled.extend(DEFAULT_COLLECTOR_SOURCES)

    enabled_sources = _unique_source_names(enabled) or DEFAULT_COLLECTOR_SOURCES
    reddit_subreddits = _unique_values([*default_reddit_subreddits, *_extract_subreddits(plan_items)])
    stack_exchange_sites = _unique_values([*default_stack_exchange_sites, *_extract_stack_exchange_sites(plan_items)])
    query_hints = plan_items[:6]
    return SourcePlanRouting(
        enabled_sources=enabled_sources,
        reddit_subreddits=reddit_subreddits,
        stack_exchange_sites=stack_exchange_sites or ("stackoverflow",),
        query_hints=query_hints,
    )


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
                    "source_query": config.query,
                    **_source_plan_metadata(config),
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
                        **_source_plan_metadata(config),
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
    if config.github_token:
        headers["Authorization"] = f"Bearer {config.github_token}"
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
                    "source_query": config.query,
                    **_source_plan_metadata(config),
                },
            )
        )
    return items


def collect_stack_exchange(config: CollectorConfig) -> list[MediaItem]:
    """Search Stack Exchange questions for durable developer pain signals."""
    items: list[MediaItem] = []
    sites = [site.strip() for site in config.stack_exchange_sites if site.strip()]
    for site in sites or ["stackoverflow"]:
        query = urlencode(
            {
                "order": "desc",
                "sort": "activity",
                "q": config.query,
                "site": site,
                "pagesize": max(1, config.limit_per_source),
                "filter": "withbody",
            }
        )
        payload = _get_json(f"https://api.stackexchange.com/2.3/search/advanced?{query}")
        for question in payload.get("items", [])[: config.limit_per_source]:
            if not isinstance(question, dict):
                continue
            body = str(question.get("body_markdown") or question.get("body") or "")
            summary = _compact_text(_html_to_text(body)) or str(question.get("title") or "Untitled Stack Exchange question")
            owner = question.get("owner") if isinstance(question.get("owner"), dict) else {}
            tags = [
                str(tag)
                for tag in question.get("tags", [])
                if tag
            ]
            items.append(
                MediaItem(
                    source="stack_exchange",
                    title=str(question.get("title") or "Untitled Stack Exchange question"),
                    url=question.get("link"),
                    summary=summary,
                    captured_text=summary,
                    published_at=_epoch_to_iso(question.get("last_activity_date") or question.get("creation_date")),
                    tags=["stack_exchange", site, *_query_tags(config.query), *tags[:5]],
                    metadata={
                        "site": site,
                        "question_id": question.get("question_id"),
                        "author": owner.get("display_name"),
                        "score": question.get("score"),
                        "answer_count": question.get("answer_count"),
                        "view_count": question.get("view_count"),
                        "is_answered": question.get("is_answered"),
                        "content_type": "question",
                        "source_query": config.query,
                        **_source_plan_metadata(config),
                    },
                )
            )
            if len(items) >= config.limit_per_source:
                return items
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


def _epoch_to_iso(value: Any) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(value))


def _html_to_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    return unescape(text)


def redact_sensitive_text(value: str, *secrets: str | None) -> str:
    redacted = str(value)
    for secret in secrets:
        clean = (secret or "").strip()
        if clean:
            redacted = redacted.replace(clean, "[REDACTED]")
    redacted = re.sub(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;\"']+", r"\1[REDACTED]", redacted)
    redacted = re.sub(r"(?i)(github_access_token\s*[:=]\s*)[^\s,;\"']+", r"\1[REDACTED]", redacted)
    redacted = re.sub(r"(?i)(access_token\s*[:=]\s*)[^\s,;\"']+", r"\1[REDACTED]", redacted)
    return redacted


def _query_tags(query: str) -> list[str]:
    tags = []
    for word in query.lower().replace("-", " ").split():
        cleaned = "".join(ch for ch in word if ch.isalnum() or ch == "_")
        if len(cleaned) >= 4 and cleaned not in tags:
            tags.append(cleaned)
    return tags[:5]


def _source_plan_metadata(config: CollectorConfig) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    if config.source_plan:
        metadata["source_plan"] = list(config.source_plan)
    if config.query_hints:
        metadata["source_plan_query_hints"] = list(config.query_hints)
    if config.enabled_sources != DEFAULT_COLLECTOR_SOURCES:
        metadata["enabled_sources"] = list(config.enabled_sources)
    return metadata


def _clean_plan_item(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _extract_subreddits(plan_items: tuple[str, ...]) -> tuple[str, ...]:
    subreddits: list[str] = []
    for item in plan_items:
        for match in re.finditer(r"(?:^|[\s,;(/])r/([A-Za-z0-9_][A-Za-z0-9_]{1,20})", item):
            subreddits.append(match.group(1))
    return _unique_values(subreddits)


def _extract_stack_exchange_sites(plan_items: tuple[str, ...]) -> tuple[str, ...]:
    site_aliases = {
        "stackoverflow": "stackoverflow",
        "stack overflow": "stackoverflow",
        "serverfault": "serverfault",
        "server fault": "serverfault",
        "superuser": "superuser",
        "stackapps": "stackapps",
        "stack apps": "stackapps",
    }
    text = " ".join(plan_items).lower()
    return _unique_values([site for alias, site in site_aliases.items() if alias in text])


def _mentions_public_discussions(text: str) -> bool:
    audience_terms = ("developer", "developers", "founder", "founders", "builder", "builders", "startup", "product")
    public_terms = ("public", "open", "online")
    broad_discussion_terms = ("discussion", "discussions", "community", "communities", "forum", "forums")
    public_discussion_terms = (*broad_discussion_terms, "posts", "threads")
    if any(term in text for term in public_terms) and any(term in text for term in public_discussion_terms):
        return True
    return any(term in text for term in audience_terms) and any(term in text for term in broad_discussion_terms)


def _unique_source_names(values: list[str]) -> tuple[str, ...]:
    allowed = set(DEFAULT_COLLECTOR_SOURCES)
    selected = set(value for value in _unique_values(values) if value in allowed)
    return tuple(source for source in DEFAULT_COLLECTOR_SOURCES if source in selected)


def _unique_values(values: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = _clean_plan_item(value).strip().strip("/")
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return tuple(result)
