Managed research report.

```json
{
  "signals": [
    {
      "source": "web",
      "title": "Developers struggle with agent deployment",
      "body": "Multiple developers describe deployment, auth, and observability as hard parts of agent apps.",
      "url": "https://example.com/agent-deployment-pain",
      "tags": ["ai_agents", "deployment"],
      "metadata": {
        "observed_pain": "deployment and observability",
        "evidence_type": "complaint"
      }
    }
  ],
  "opportunities": [
    {
      "title": "Agent deployment smoke-test runner",
      "problem": "Teams need a repeatable way to verify agent deployment behavior before production.",
      "target_user": "Developers shipping managed agents",
      "mvp_concept": "CLI and dashboard that runs auth, tool, and observability checks against an agent deployment.",
      "score": 0.78,
      "score_rationale": "Clear developer pain and a small MVP surface.",
      "source_indexes": [0],
      "profile": {
        "facts": ["Deployment and observability are recurring pain areas."],
        "inferences": ["A smoke-test workflow could reduce launch risk."],
        "risks": ["May need integrations with multiple agent platforms."]
      }
    }
  ]
}
```

