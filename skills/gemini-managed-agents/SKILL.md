---
name: gemini-managed-agents
description: "Design, configure, and invoke Google Gemini Managed Agents in remote sandboxes using the Interactions API."
---

# Gemini Managed Agents Skill

This skill equips agents with the knowledge required to deploy and invoke Google Gemini Managed Agents inside remote execution sandboxes using the official `google-genai` library.

## 1. Core API Usage Patterns

Managed Agents separate the creation of the agent configuration (definition) from the execution (interaction).

### A. Registering a Persistent Agent (`client.agents.create`)
Use `client.agents.create` to register system instructions, models, tools, and files:

```python
from google import genai

client = genai.Client()

# Create a custom agent configuration
pm_agent = client.agents.create(
    id="product-strategist",
    base_agent="antigravity-preview-05-2026",
    system_instruction="You are a PM strategist. Focus on user value and PMF.",
    base_environment={
        "type": "remote",
        "sources": [
            {
                "type": "inline",
                "target": "AGENTS.md",
                "content": "Core guidelines: Focus on retention and utility."
            }
        ]
    }
)
```

### B. Invoking an Agent (`client.interactions.create`)
To run a task with a registered agent in a remote sandbox:

```python
interaction = client.interactions.create(
    agent="product-strategist",
    input="Identify core user pain points from our latest reviews.",
    environment="remote" # Launches remote Linux container
)

print(interaction.output_text)
```

---

## 2. Managing Stateful Sessions

The Interactions API handles conversation history and sandbox state server-side.

### A. Conversation History
To continue a multi-turn conversation, pass the previous interaction's ID:

```python
follow_up = client.interactions.create(
    agent="product-strategist",
    input="Map these pain points to user stories.",
    previous_interaction_id=interaction.id
)
```

### B. Filesystem Persistence
When calling with `environment="remote"`, files created or modified in the sandbox persist across turns under the same conversation tree. You can save scripts, configuration files, or data outputs, and access them in subsequent turns.
*   **Snapshots:** The sandbox is snapshotted after 15 minutes of inactivity.
*   **Retention:** Inactive environments are retained for up to 7 days.
