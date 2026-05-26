import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationStatusForResearchBriefStatus,
  latestApprovedResearchBrief,
  researchBriefApprovalMessage,
  researchBriefCanBeApproved,
  researchBriefCanRun
} from "./ideas/research-brief-approval.ts";
import type { DbResearchBrief, ResearchBriefReadiness } from "./db/types.ts";

test("only ready research briefs can be approved by the user", () => {
  assert.equal(researchBriefCanBeApproved(brief("ready_for_research")), true);
  assert.equal(researchBriefCanBeApproved(brief("needs_context")), false);
  assert.equal(researchBriefCanBeApproved(brief("approved")), false);
  assert.equal(researchBriefCanBeApproved(brief("running")), false);
  assert.equal(researchBriefCanBeApproved(brief("completed")), false);
});

test("only approved research briefs can start agent research", () => {
  assert.equal(researchBriefCanRun(brief("approved")), true);
  assert.equal(researchBriefCanRun(brief("ready_for_research")), false);
  assert.equal(researchBriefCanRun(brief("needs_context")), false);
});

test("manual pipeline selection ignores ready but unapproved briefs", () => {
  const selected = latestApprovedResearchBrief([
    brief("ready_for_research", "brief_ready", "2026-01-03T00:00:00.000Z"),
    brief("approved", "brief_old", "2026-01-01T00:00:00.000Z"),
    brief("completed", "brief_completed", "2026-01-04T00:00:00.000Z")
  ]);

  assert.equal(selected?.id, "brief_old");
});

test("approval messages distinguish incomplete and already-run briefs", () => {
  assert.match(researchBriefApprovalMessage(brief("needs_context")), /more context/i);
  assert.match(researchBriefApprovalMessage(brief("approved")), /waiting to start/i);
  assert.match(researchBriefApprovalMessage(brief("running")), /already running/i);
  assert.match(researchBriefApprovalMessage(brief("completed")), /already complete/i);
  assert.match(researchBriefApprovalMessage(null), /not found/i);
});

test("conversation status follows research brief lifecycle", () => {
  assert.equal(conversationStatusForResearchBriefStatus("needs_context"), "active");
  assert.equal(conversationStatusForResearchBriefStatus("ready_for_research"), "brief_ready");
  assert.equal(conversationStatusForResearchBriefStatus("approved"), "researching");
  assert.equal(conversationStatusForResearchBriefStatus("running"), "researching");
  assert.equal(conversationStatusForResearchBriefStatus("completed"), "closed");
});

function brief(
  status: ResearchBriefReadiness,
  id = `brief_${status}`,
  updatedAt = "2026-01-01T00:00:00.000Z"
): DbResearchBrief {
  return {
    id,
    project_id: "project_1",
    status,
    hypothesis: "AI-led research intake",
    target_users: ["solo founders"],
    pain_area: "finding product ideas",
    constraints: [],
    source_plan: [],
    disqualifying_evidence: [],
    mvp_boundaries: [],
    user_taste_notes: [],
    open_questions: [],
    confidence: 0.5,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: updatedAt
  };
}
