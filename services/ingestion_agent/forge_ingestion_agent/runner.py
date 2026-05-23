"""Local runner for the Forge ingestion agent tools."""

from __future__ import annotations

import argparse
import json

from .tools import run_ingestion_cycle


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Forge ingestion locally.")
    parser.add_argument("--keywords", required=True, help="Comma-separated keywords.")
    parser.add_argument("--subreddits", default="", help="Comma-separated subreddit names.")
    parser.add_argument("--max-items", type=int, default=25)
    parser.add_argument("--max-points", type=int, default=10)
    parser.add_argument("--no-save", action="store_true", help="Skip Supabase persistence.")
    args = parser.parse_args()

    result = run_ingestion_cycle(
        keywords=_csv(args.keywords),
        subreddits=_csv(args.subreddits),
        max_items=args.max_items,
        max_points=args.max_points,
        save=not args.no_save,
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

