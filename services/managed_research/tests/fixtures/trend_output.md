TrendScout retrieved public evidence.

```json
{
  "media_items": [
    {
      "source": "forum",
      "title": "Developers report runaway AI agent loops",
      "url": "https://example.com/runaway-agent-loop",
      "summary": "A developer describes an autonomous agent repeatedly retrying tool calls and burning through API budget.",
      "captured_text": "The agent kept calling the same tool after failures and costs climbed before anyone noticed.",
      "published_at": null,
      "tags": ["ai_agents", "cost_controls"],
      "metadata": {
        "why_relevant": "Shows concrete production deployment pain.",
        "content_type": "complaint"
      }
    },
    {
      "source": "github",
      "title": "Issue thread asks for max-turn guardrails",
      "url": "https://example.com/repo/issues/42",
      "summary": "Repository users request configurable max-turn and max-cost limits for agent runs.",
      "captured_text": "Users want hard limits before an agent can continue expensive retry loops.",
      "published_at": null,
      "tags": ["ai_agents", "github_issue"],
      "metadata": {
        "why_relevant": "Shows repeated feature demand in a developer workflow.",
        "content_type": "issue"
      }
    }
  ]
}
```
