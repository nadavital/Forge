"""Gemini Interactions API client for managed agents."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .schemas import MediaItem

DEFAULT_ANTIGRAVITY_AGENT = "antigravity-preview-05-2026"
DEFAULT_DEEP_RESEARCH_AGENT = "deep-research-preview-04-2026"
API_REVISION = "2026-05-20"


class ManagedAgentClient:
    def __init__(self, api_key: str | None = None) -> None:
        from google import genai

        self.client = genai.Client(api_key=api_key)

    def run_antigravity(
        self,
        topic: str,
        agents_dir: Path,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_antigravity_prompt(topic),
            agents_dir=agents_dir,
            system_instruction="You are Forge's managed ingestion agent. Return valid JSON evidence.",
            timeout_seconds=timeout_seconds,
        )

    def run_antigravity_prompt(
        self,
        prompt: str,
        agents_dir: Path,
        system_instruction: str,
        timeout_seconds: int = 300,
    ) -> str:
        interaction = self.client.interactions.create(
            agent=DEFAULT_ANTIGRAVITY_AGENT,
            input=prompt,
            system_instruction=system_instruction,
            environment={
                "type": "remote",
                "sources": [
                    {
                        "type": "inline",
                        "target": ".agents/AGENTS.md",
                        "content": (agents_dir / "ingestion" / "AGENTS.md").read_text(),
                    },
                    {
                        "type": "inline",
                        "target": ".agents/skills/pain-extraction/SKILL.md",
                        "content": (
                            agents_dir / "skills" / "pain-extraction" / "SKILL.md"
                        ).read_text(),
                    },
                ],
            },
            tools=[
                {"type": "google_search"},
                {"type": "url_context"},
                {"type": "code_execution"},
            ],
        )
        return getattr(interaction, "output_text", "") or str(interaction)

    def run_trend_scout(
        self,
        topic: str,
        agents_dir: Path,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_trend_scout_prompt(topic),
            agents_dir=agents_dir,
            system_instruction="You are Forge's TrendScout managed media agent. Return retrieved evidence, not conclusions.",
            timeout_seconds=timeout_seconds,
        )

    def run_research_analyst(
        self,
        topic: str,
        media_items: list[MediaItem],
        agents_dir: Path,
        agent: str,
        timeout_seconds: int = 900,
    ) -> str:
        prompt = _research_analyst_prompt(topic, media_items)
        if agent == "deep-research":
            return self.run_deep_research_prompt(prompt, timeout_seconds=timeout_seconds)
        if agent == "antigravity":
            return self.run_antigravity_prompt(
                prompt=prompt,
                agents_dir=agents_dir,
                system_instruction="You are Forge's ResearchAnalyst managed agent. Research only the provided TrendScout evidence.",
                timeout_seconds=min(timeout_seconds, 300),
            )
        raise ValueError(f"Unsupported research agent: {agent}")

    def run_deep_research(
        self,
        topic: str,
        timeout_seconds: int = 900,
        poll_seconds: int = 10,
    ) -> str:
        return self.run_deep_research_prompt(
            _deep_research_prompt(topic),
            timeout_seconds=timeout_seconds,
            poll_seconds=poll_seconds,
        )

    def run_deep_research_prompt(
        self,
        prompt: str,
        timeout_seconds: int = 900,
        poll_seconds: int = 10,
    ) -> str:
        interaction = self.client.interactions.create(
            agent=DEFAULT_DEEP_RESEARCH_AGENT,
            input=prompt,
            agent_config={
                "type": "deep-research",
                "thinking_summaries": "auto",
            },
            background=True,
        )
        interaction_id = getattr(interaction, "id", None)
        if not interaction_id:
            return getattr(interaction, "output_text", "") or str(interaction)

        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            try:
                current = self.client.interactions.get(id=interaction_id)
            except TypeError:
                current = self.client.interactions.get(name=interaction_id)
            state = getattr(current, "state", None) or getattr(current, "status", None)
            state_text = str(state).lower()
            if "completed" in state_text or "succeeded" in state_text:
                return getattr(current, "output_text", "") or str(current)
            if "failed" in state_text or "cancelled" in state_text:
                raise RuntimeError(f"Deep Research interaction failed: {current}")
            time.sleep(poll_seconds)
        raise TimeoutError(f"Deep Research interaction did not complete in {timeout_seconds}s")


def _antigravity_prompt(topic: str) -> str:
    return f"""
Research developer/product pain for this Forge topic:

{topic}

Inspect public web and repository evidence. Identify concrete pain signals and candidate MVP opportunities.

Return exactly one fenced JSON block matching:
{{
  "signals": [
    {{
      "source": "web|github|forum|docs|social",
      "title": "...",
      "body": "...",
      "url": "https://...",
      "tags": ["..."],
      "metadata": {{"observed_pain": "...", "evidence_type": "..."}}
    }}
  ],
  "opportunities": [
    {{
      "title": "...",
      "problem": "...",
      "target_user": "...",
      "mvp_concept": "...",
      "score": 0.0,
      "score_rationale": "...",
      "source_indexes": [0],
      "profile": {{"facts": [], "inferences": [], "risks": []}}
    }}
  ]
}}
"""


def _deep_research_prompt(topic: str) -> str:
    return f"""
Conduct cited research on developer/product pain for:

{topic}

Focus on public evidence, repeated complaints, repository activity, issue patterns, workarounds, and signs that a small MVP could test the pain.

End with one fenced JSON block containing `signals` and `opportunities` using the Forge schema.
"""


def _trend_scout_prompt(topic: str) -> str:
    return f"""
You are TrendScout for Forge.

Find current public media, social, forum, repository, issue, discussion, launch, or documentation content for:

{topic}

Return retrieved evidence only. Do not produce opportunities. Prefer concrete content that a researcher can inspect later.

Return exactly one fenced JSON block:
{{
  "media_items": [
    {{
      "source": "web|forum|github|docs|social|news",
      "title": "...",
      "url": "https://...",
      "summary": "short faithful summary of the retrieved item",
      "captured_text": "short excerpt or paraphrase of the relevant content",
      "published_at": "ISO timestamp if available, otherwise null",
      "tags": ["..."],
      "metadata": {{
        "why_relevant": "...",
        "content_type": "complaint|issue|launch|discussion|article|repo"
      }}
    }}
  ]
}}
"""


def _research_analyst_prompt(topic: str, media_items: list[MediaItem]) -> str:
    evidence = [
        {
            "index": index,
            "source": item.source,
            "title": item.title,
            "url": item.url,
            "summary": item.summary,
            "captured_text": item.captured_text,
            "tags": item.tags,
        }
        for index, item in enumerate(media_items)
    ]
    return f"""
You are ResearchAnalyst for Forge.

Research product and developer pain for this topic, but ground your work in the TrendScout media items below:

{topic}

TrendScout media items:
{evidence}

Rules:
- Use the media items as the starting evidence.
- Add citations only when they support or clarify the media item.
- Distinguish observed pain from inference and risk.
- Do not claim market validation.
- Do not invent media item indexes.

Return a concise report followed by exactly one fenced JSON block:
{{
  "research_findings": [
    {{
      "title": "...",
      "summary": "...",
      "citations": ["https://..."],
      "media_item_indexes": [0],
      "observed_pain": "...",
      "inference": "...",
      "risk": "...",
      "metadata": {{"research_depth": "quick|deep"}}
    }}
  ],
  "signals": [
    {{
      "source": "research",
      "title": "...",
      "body": "...",
      "url": "https://...",
      "tags": ["..."],
      "metadata": {{
        "observed_pain": "...",
        "evidence_type": "complaint|issue|workaround|trend|repo",
        "media_item_indexes": [0],
        "research_finding_indexes": [0]
      }}
    }}
  ],
  "opportunities": [
    {{
      "title": "...",
      "problem": "...",
      "target_user": "...",
      "mvp_concept": "...",
      "score": 0.0,
      "score_rationale": "...",
      "source_indexes": [0],
      "profile": {{"facts": [], "inferences": [], "risks": []}}
    }}
  ]
}}
"""
