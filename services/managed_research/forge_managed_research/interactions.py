"""Gemini Interactions API client for managed agents."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

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
        interaction = self.client.interactions.create(
            agent=DEFAULT_ANTIGRAVITY_AGENT,
            input=_antigravity_prompt(topic),
            system_instruction="You are Forge's managed ingestion agent. Return valid JSON evidence.",
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

    def run_deep_research(
        self,
        topic: str,
        timeout_seconds: int = 900,
        poll_seconds: int = 10,
    ) -> str:
        interaction = self.client.interactions.create(
            agent=DEFAULT_DEEP_RESEARCH_AGENT,
            input=_deep_research_prompt(topic),
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
