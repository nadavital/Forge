import assert from "node:assert/strict";
import test from "node:test";
import { discoverNewProductIdeas } from "./ideas/new-product-discovery.ts";
import type { DbResearchBrief } from "./db/types.ts";

test("new product discovery converts an approved AI intake brief into hypothesis records", () => {
  const brief: DbResearchBrief = {
    id: "brief_1",
    project_id: "project_1",
    conversation_id: "conv_1",
    status: "approved",
    hypothesis: "Solo iOS developers need a lighter App Store screenshot workflow",
    target_users: ["Solo iOS developers"],
    pain_area: "App Store screenshot production takes too much repeated manual work.",
    constraints: ["Free services only"],
    source_plan: ["Search GitHub issues for screenshot automation pain"],
    disqualifying_evidence: ["Existing free tools already solve the full workflow"],
    mvp_boundaries: ["Local screenshot planner and checklist"],
    user_taste_notes: ["Narrow, local-first MVPs"],
    open_questions: [],
    confidence: 0.52
  };

  const result = discoverNewProductIdeas({
    projectName: "Screenshot helper",
    researchBrief: brief
  });

  assert.equal(result.signals[0].source, "research_brief");
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].profile?.origin, "ai_intake_research_brief");
  assert.equal(result.opportunities[0].status, "researching");
  assert.equal(result.opportunities[0].evaluations[0].scores?.recommendation, "research_more");
});
