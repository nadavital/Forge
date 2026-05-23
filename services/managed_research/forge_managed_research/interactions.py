"""Gemini Interactions API client for managed agents."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .schemas import MediaItem, OpportunityCluster

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

    def run_topic_seeder(
        self,
        theme: str,
        agents_dir: Path,
        max_topics: int,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_topic_seed_prompt(theme, max_topics=max_topics),
            agents_dir=agents_dir,
            system_instruction="You are Forge's TopicSeeder managed trend agent. Discover promising research topics from public evidence.",
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

    def run_bull_agent(
        self,
        cluster: OpportunityCluster,
        agents_dir: Path,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_bull_agent_prompt(cluster),
            agents_dir=agents_dir,
            system_instruction="You are Forge's BullAgent. Argue the strongest credible case for this product direction.",
            timeout_seconds=timeout_seconds,
        )

    def run_bear_agent(
        self,
        cluster: OpportunityCluster,
        agents_dir: Path,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_bear_agent_prompt(cluster),
            agents_dir=agents_dir,
            system_instruction="You are Forge's BearAgent. Challenge feasibility, demand, evidence quality, and MVP scope.",
            timeout_seconds=timeout_seconds,
        )

    def run_decision_agent(
        self,
        cluster: OpportunityCluster,
        bull: dict[str, Any],
        bear: dict[str, Any],
        agents_dir: Path,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_decision_agent_prompt(cluster, bull, bear),
            agents_dir=agents_dir,
            system_instruction="You are Forge's DecisionAgent. Recommend the next action from the evidence and debate.",
            timeout_seconds=timeout_seconds,
        )

    def run_synthesizer_agent(
        self,
        cluster: OpportunityCluster,
        bull: dict[str, Any],
        bear: dict[str, Any],
        decision: dict[str, Any],
        agents_dir: Path,
        timeout_seconds: int = 300,
    ) -> str:
        return self.run_antigravity_prompt(
            prompt=_synthesizer_agent_prompt(cluster, bull, bear, decision),
            agents_dir=agents_dir,
            system_instruction="You are Forge's Synthesizer. Turn an approved product direction into a pitch and builder system prompt.",
            timeout_seconds=timeout_seconds,
        )

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

        print(f"deep_research: interaction_id={interaction_id}", flush=True)
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            try:
                current = self.client.interactions.get(id=interaction_id)
            except TypeError:
                current = self.client.interactions.get(name=interaction_id)
            state = getattr(current, "state", None) or getattr(current, "status", None)
            state_text = str(state).lower()
            print(f"deep_research: state={state_text}", flush=True)
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


def _topic_seed_prompt(theme: str, max_topics: int) -> str:
    return f"""
You are TopicSeeder for Forge.

The user may not know what product direction to investigate. Discover up to {max_topics} promising research topics from current public technical pain around this broad theme:

{theme}

Look across public developer discussions, forums, repository issues, launch comments, docs friction, and technical media. Return candidate topics, not full opportunities. Each topic should be specific enough that a follow-up TrendScout can retrieve evidence.

Rules:
- Prefer repeated, concrete pain over generic hype.
- Include source URLs that justify why the topic is worth researching.
- Avoid topics that require paid/private data to investigate.
- Do not claim market validation.

Return exactly one fenced JSON block:
{{
  "seed_topics": [
    {{
      "topic": "specific research query for TrendScout",
      "title": "short topic title",
      "rationale": "why this seems worth a Forge trend-to-research run",
      "score": 0.0,
      "sources": ["https://..."],
      "tags": ["..."],
      "metadata": {{
        "observed_pattern": "...",
        "risk": "..."
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


def _cluster_packet(cluster: OpportunityCluster) -> dict[str, Any]:
    return {
        "canonical_title": cluster.canonical_title,
        "problem": cluster.problem,
        "target_user": cluster.target_user,
        "mvp_concept": cluster.mvp_concept,
        "score": cluster.score,
        "variants": cluster.variants,
        "why_clustered": cluster.why_clustered,
        "evidence": [
            {
                "source": signal.source,
                "title": signal.title,
                "body": signal.body,
                "url": signal.url,
                "tags": signal.tags,
            }
            for signal in cluster.evidence[:12]
        ],
    }


def _bull_agent_prompt(cluster: OpportunityCluster) -> str:
    return f"""
You are BullAgent for Forge.

Evaluate this canonical product opportunity cluster:
{_cluster_packet(cluster)}

Argue the strongest credible case for building an MVP. Stay grounded in the evidence packet.
Do not claim market validation. Distinguish observed facts from inferences.

Return exactly one fenced JSON block:
{{
  "position": "bull",
  "summary": "short strongest-case argument",
  "why_real_pain": ["..."],
  "why_now": ["..."],
  "adoption_case": ["..."],
  "smallest_convincing_mvp": "...",
  "supporting_evidence_urls": ["https://..."],
  "confidence": 0.0,
  "risks_to_watch": ["..."]
}}
"""


def _bear_agent_prompt(cluster: OpportunityCluster) -> str:
    return f"""
You are BearAgent for Forge.

Evaluate this canonical product opportunity cluster:
{_cluster_packet(cluster)}

Argue the strongest credible case against building this MVP now. Challenge weak evidence, buyer urgency,
existing alternatives, scope traps, and whether the MVP is too generic. Stay grounded in the packet.

Return exactly one fenced JSON block:
{{
  "position": "bear",
  "summary": "short strongest-case objection",
  "why_might_be_noise": ["..."],
  "adoption_risks": ["..."],
  "existing_alternatives": ["..."],
  "scope_traps": ["..."],
  "missing_evidence": ["..."],
  "confidence": 0.0
}}
"""


def _decision_agent_prompt(
    cluster: OpportunityCluster,
    bull: dict[str, Any],
    bear: dict[str, Any],
) -> str:
    return f"""
You are DecisionAgent for Forge.

Canonical opportunity:
{_cluster_packet(cluster)}

Bull case:
{bull}

Bear case:
{bear}

Choose one recommendation: reject, watch, research_more, prototype, build.
For v1, generated repo builds require human approval; do not bypass that.

Return exactly one fenced JSON block:
{{
  "recommendation": "reject|watch|research_more|prototype|build",
  "summary": "short decision rationale",
  "confidence": 0.0,
  "required_mvp_constraints": ["..."],
  "next_action": "...",
  "approval_needed": true,
  "evidence_gaps": ["..."]
}}
"""


def _synthesizer_agent_prompt(
    cluster: OpportunityCluster,
    bull: dict[str, Any],
    bear: dict[str, Any],
    decision: dict[str, Any],
) -> str:
    return f"""
You are Synthesizer for Forge.

Turn this debated product direction into two artifacts:
1. A concise product pitch for human review.
2. A system prompt that a managed sandbox builder can use later to build the site or MVP after human approval.

Canonical opportunity:
{_cluster_packet(cluster)}

Bull case:
{bull}

Bear case:
{bear}

Decision:
{decision}

Rules:
- The builder prompt must stay inside the approved opportunity.
- The builder prompt must require a runnable MVP, README, smoke test, and no paid APIs or secret-requiring integrations.
- Do not instruct the builder to deploy to production.
- If the decision is not prototype or build, the builder prompt should be marked not_ready.

Return exactly one fenced JSON block:
{{
  "product_pitch": "publication-quality but concise pitch",
  "target_user": "...",
  "mvp_scope": ["..."],
  "non_goals": ["..."],
  "builder_system_prompt": "...",
  "builder_readiness": "ready|not_ready",
  "confidence": 0.0
}}
"""
