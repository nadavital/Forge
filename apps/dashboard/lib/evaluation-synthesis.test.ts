import assert from "node:assert/strict";
import test from "node:test";
import { synthesisFromEvaluations } from "./evaluation-synthesis.ts";
import type { DbEvaluation } from "./db/types.ts";

test("synthesis extraction preserves builder payload from synthesizer evaluations", () => {
  const synthesis = synthesisFromEvaluations([
    {
      id: "eval_1",
      opportunity_id: "opp_1",
      evaluator: "synthesizer_agent",
      content: "Build a focused launch planner.",
      scores: {
        payload: {
          product_pitch: "A local-first launch planner for solo iOS developers.",
          mvp_scope: ["Checklist", "Copy notes", "Export plan"],
          non_goals: ["App Store upload automation"],
          builder_system_prompt: "Build the planner as a local runnable prototype.",
          builder_readiness: "ready"
        }
      }
    } satisfies DbEvaluation
  ]);

  assert.equal(synthesis?.productPitch, "A local-first launch planner for solo iOS developers.");
  assert.deepEqual(synthesis?.mvpScope, ["Checklist", "Copy notes", "Export plan"]);
  assert.deepEqual(synthesis?.nonGoals, ["App Store upload automation"]);
  assert.equal(synthesis?.builderSystemPrompt, "Build the planner as a local runnable prototype.");
  assert.equal(synthesis?.builderReadiness, "ready");
});

test("synthesis extraction falls back to evaluation content for older rows", () => {
  const synthesis = synthesisFromEvaluations([
    {
      id: "eval_2",
      opportunity_id: "opp_1",
      evaluator: "synthesizer",
      content: "Build a focused launch planner.",
      scores: {}
    } satisfies DbEvaluation
  ]);

  assert.equal(synthesis?.productPitch, "Build a focused launch planner.");
  assert.deepEqual(synthesis?.mvpScope, []);
  assert.deepEqual(synthesis?.nonGoals, []);
});
