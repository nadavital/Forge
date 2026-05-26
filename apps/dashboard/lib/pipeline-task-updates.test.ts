import assert from "node:assert/strict";
import test from "node:test";
import { taskUpdatesForResearch } from "./research/agent-task-updates.ts";

test("brief research tasks wait with explicit details when managed research is not configured", () => {
  const updates = taskUpdatesForResearch([
    { id: "task_1", agent_role: "SourceCollector" },
    { id: "task_2", agent_role: "DecisionAgent" }
  ]);

  assert.equal(updates[0].status, "queued");
  assert.equal(updates[0].result?.status, "waiting_for_managed_research_backend");
  assert.match(String(updates[0].result?.summary), /FORGE_MANAGED_RESEARCH_URL/);
  assert.match(String(updates[0].result?.summary), /FORGE_MANAGED_RESEARCH_SECRET/);
});

test("brief research tasks complete evaluation roles when managed evaluation rows return", () => {
  const updates = taskUpdatesForResearch(
    [
      { id: "task_1", agent_role: "SourceCollector" },
      { id: "task_2", agent_role: "Researcher" },
      { id: "task_3", agent_role: "BullAgent" },
      { id: "task_4", agent_role: "BearAgent" },
      { id: "task_5", agent_role: "TasteCritic" },
      { id: "task_6", agent_role: "DecisionAgent" },
      { id: "task_7", agent_role: "Synthesizer" }
    ],
    {
      signal_count: 3,
      opportunity_count: 1,
      evaluation_count: 4,
      evaluation_roles: ["bull", "bear", "decision_agent", "synthesizer_agent", "taste_critic"],
      evaluation_opportunity_count: 1
    }
  );

  assert.deepEqual(
    updates.map((update) => update.status),
    ["completed", "completed", "completed", "completed", "completed", "completed", "completed"]
  );
  assert.match(String(updates[0].result?.summary), /Collected 3 source signals/);
  assert.match(String(updates[1].result?.summary), /Synthesized 1 candidate/);
  assert.match(String(updates[5].result?.summary), /decision guidance/);
  assert.match(String(updates[6].result?.summary), /synthesized build direction/);
});

test("brief research task summaries surface evidence gate progress", () => {
  const updates = taskUpdatesForResearch(
    [
      { id: "task_1", agent_role: "Researcher" },
      { id: "task_2", agent_role: "DecisionAgent" },
      { id: "task_3", agent_role: "Synthesizer" }
    ],
    {
      signal_count: 2,
      opportunity_count: 1,
      evaluation_count: 3,
      evaluation_roles: ["decision_agent", "synthesizer_agent"],
      evaluation_opportunity_count: 1,
      evidence_summary: {
        opportunities: 1,
        build_ready_opportunities: 0,
        needs_more_evidence_opportunities: 1,
        reasons: ["Needs at least two linked public-source signals."]
      }
    }
  );

  assert.match(String(updates[0].result?.summary), /still need more cited evidence/);
  assert.match(String(updates[1].result?.summary), /Recommended more research/);
  assert.match(String(updates[1].result?.summary), /Needs at least two linked public-source signals/);
  assert.match(String(updates[2].result?.summary), /no candidate cleared the build evidence gate/);
});

test("brief research falls back to count-based completion for older metadata", () => {
  const updates = taskUpdatesForResearch(
    [
      { id: "task_1", agent_role: "SourceCollector" },
      { id: "task_2", agent_role: "Researcher" },
      { id: "task_3", agent_role: "DecisionAgent" }
    ],
    {
      signal_count: 3,
      opportunity_count: 1,
      evaluation_count: 4
    }
  );

  assert.deepEqual(
    updates.map((update) => update.status),
    ["completed", "completed", "completed"]
  );
  assert.match(String(updates[0].result?.summary), /Collected 3 source signals/);
  assert.match(String(updates[1].result?.summary), /Synthesized 1 candidate/);
  assert.match(String(updates[2].result?.summary), /decision guidance/);
});

test("brief research keeps missing role evaluations queued", () => {
  const updates = taskUpdatesForResearch(
    [
      { id: "task_1", agent_role: "SourceCollector" },
      { id: "task_2", agent_role: "BullAgent" },
      { id: "task_3", agent_role: "BearAgent" },
      { id: "task_4", agent_role: "Synthesizer" }
    ],
    {
      signal_count: 2,
      opportunity_count: 1,
      evaluation_count: 1,
      evaluation_roles: ["bull"]
    }
  );

  assert.equal(updates[0].status, "completed");
  assert.equal(updates[1].status, "completed");
  assert.equal(updates[2].status, "queued");
  assert.equal(updates[3].status, "queued");
  assert.match(String(updates[2].result?.summary), /Waiting for bear case/);
  assert.match(String(updates[3].result?.summary), /Waiting for synthesized build direction/);
  assert.deepEqual(updates[2].result?.received_evaluation_roles, ["bull"]);
});

test("brief research keeps TasteCritic separate from Synthesizer", () => {
  const updates = taskUpdatesForResearch(
    [
      { id: "task_1", agent_role: "TasteCritic" },
      { id: "task_2", agent_role: "Synthesizer" }
    ],
    {
      signal_count: 2,
      opportunity_count: 1,
      evaluation_count: 1,
      evaluation_roles: ["synthesizer_agent"]
    }
  );

  assert.equal(updates[0].status, "queued");
  assert.equal(updates[1].status, "completed");
  assert.match(String(updates[0].result?.summary), /Waiting for taste critique/);
  assert.match(String(updates[1].result?.summary), /synthesized build direction/);
});
