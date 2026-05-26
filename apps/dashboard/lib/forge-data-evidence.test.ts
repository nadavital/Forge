import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOpportunityEvidence,
  evidenceStateLabel,
  evidenceStateSummary,
  mapOpportunityEvidenceState
} from "./opportunity-evidence-state.ts";

test("opportunity evidence state preserves brief-only hypotheses", () => {
  const state = mapOpportunityEvidenceState(
    { origin: "ai_intake_research_brief", evidence_state: "brief_only" },
    1
  );

  assert.equal(state, "brief_only");
  assert.equal(evidenceStateLabel(state), "Hypothesis");
  assert.match(evidenceStateSummary(state, 1), /conversation brief/i);
});

test("opportunity evidence state recognizes source-collected research", () => {
  const state = mapOpportunityEvidenceState(
    { origin: "approved_research_brief", evidence_state: "source_collected" },
    3
  );

  assert.equal(state, "source_collected");
  assert.equal(evidenceStateLabel(state), "Source-backed");
  assert.match(evidenceStateSummary(state, 3), /3 linked source signals/);
});

test("opportunity evidence state recognizes repo analysis output", () => {
  const state = mapOpportunityEvidenceState({ origin: "antigravity_repo_analysis" }, 2);

  assert.equal(state, "repo_evidence");
  assert.equal(evidenceStateLabel(state), "Repo evidence");
});

test("opportunity evidence assessment requires multiple cited public-source signals for market build readiness", () => {
  const thin = assessOpportunityEvidence({
    profile: { origin: "approved_research_brief", evidence_state: "source_collected" },
    evidenceCount: 1,
    evidence: [{ source: "hn", url: "https://example.com/one" }]
  });
  const uncited = assessOpportunityEvidence({
    profile: { origin: "approved_research_brief", evidence_state: "source_collected" },
    evidenceCount: 2,
    evidence: [
      { source: "notes", url: null },
      { source: "manual", url: "" }
    ]
  });
  const sufficient = assessOpportunityEvidence({
    profile: { origin: "approved_research_brief", evidence_state: "source_collected" },
    evidenceCount: 2,
    evidence: [
      { source: "hn", url: "https://example.com/one" },
      { source: "github", url: null }
    ]
  });

  assert.equal(thin.sufficientForBuild, false);
  assert.match(thin.reason, /two linked public-source signals/);
  assert.equal(uncited.sufficientForBuild, false);
  assert.match(uncited.reason, /cited source URL/);
  assert.equal(sufficient.sufficientForBuild, true);
});

test("opportunity evidence assessment allows linked repo evidence without public-source URLs", () => {
  const assessment = assessOpportunityEvidence({
    profile: { origin: "antigravity_repo_analysis" },
    evidenceCount: 1,
    evidence: [{ source: "github_issue", url: null }]
  });

  assert.equal(assessment.state, "repo_evidence");
  assert.equal(assessment.sufficientForBuild, true);
});
