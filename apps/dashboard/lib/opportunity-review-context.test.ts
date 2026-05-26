import assert from "node:assert/strict";
import test from "node:test";
import { mapOpportunityReviewContext } from "./opportunity-review-context.ts";

test("opportunity review context preserves approved brief guardrails from profile", () => {
  const context = mapOpportunityReviewContext({
    source_plan: ["GitHub issues", "public founder forums"],
    constraints: ["No paid APIs"],
    disqualifying_evidence: ["Existing free tools solve this fully"],
    mvp_boundaries: ["Local brief compiler"],
    user_taste_notes: ["Calm product partner"],
    open_questions: ["Which founder segment repeats the pain weekly?"]
  });

  assert.deepEqual(context, {
    sourcePlan: ["GitHub issues", "public founder forums"],
    constraints: ["No paid APIs"],
    disqualifyingEvidence: ["Existing free tools solve this fully"],
    mvpBoundaries: ["Local brief compiler"],
    userTasteNotes: ["Calm product partner"],
    openQuestions: ["Which founder segment repeats the pain weekly?"]
  });
});

test("opportunity review context stays absent for profiles without brief guardrails", () => {
  assert.equal(mapOpportunityReviewContext({ origin: "antigravity_repo_analysis" }), undefined);
  assert.equal(mapOpportunityReviewContext(null), undefined);
});
