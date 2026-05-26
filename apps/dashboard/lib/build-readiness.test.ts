import assert from "node:assert/strict";
import test from "node:test";
import { buildReadinessForOpportunity } from "./build/readiness.ts";

test("build readiness blocks brief-only hypotheses", () => {
  const readiness = buildReadinessForOpportunity({
    opportunity: {
      status: "researching",
      profile: { origin: "ai_intake_research_brief", evidence_state: "brief_only" }
    },
    evaluations: [
      {
        evaluator: "decision_agent",
        scores: { recommendation: "research_more" }
      }
    ],
    evidenceCount: 1
  });

  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /Research this hypothesis/);
});

test("build readiness allows sourced prototype or build recommendations", () => {
  const readiness = buildReadinessForOpportunity({
    opportunity: {
      status: "proposed",
      profile: { origin: "approved_research_brief", evidence_state: "source_collected" }
    },
    evaluations: [
      {
        evaluator: "decision_agent",
        scores: { recommendation: "prototype" }
      }
    ],
    evidenceCount: 3,
    evidence: [
      { source: "hn", url: "https://example.com/pain-1" },
      { source: "reddit", url: null },
      { source: "github", url: "https://github.com/acme/repo/issues/1" }
    ]
  });

  assert.equal(readiness.canBuild, true);
});

test("build readiness blocks source-collected opportunities with thin evidence", () => {
  const readiness = buildReadinessForOpportunity({
    opportunity: {
      status: "proposed",
      profile: { origin: "approved_research_brief", evidence_state: "source_collected" }
    },
    evaluations: [
      {
        evaluator: "decision_agent",
        scores: { recommendation: "build" }
      }
    ],
    evidenceCount: 1,
    evidence: [{ source: "manual", url: null }]
  });

  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /at least two linked public-source signals/);
});

test("build readiness requires a cited URL for source-collected market research", () => {
  const readiness = buildReadinessForOpportunity({
    opportunity: {
      status: "proposed",
      profile: { origin: "approved_research_brief", evidence_state: "source_collected" }
    },
    evaluations: [
      {
        evaluator: "decision_agent",
        scores: { recommendation: "build" }
      }
    ],
    evidenceCount: 2,
    evidence: [
      { source: "manual", url: null },
      { source: "notes", url: "" }
    ]
  });

  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /cited source URL/);
});

test("build readiness allows repo-evidence recommendations with linked repo signals", () => {
  const readiness = buildReadinessForOpportunity({
    opportunity: {
      status: "proposed",
      profile: { origin: "antigravity_repo_analysis" }
    },
    evaluations: [
      {
        evaluator: "decision_agent",
        scores: { recommendation: "build" }
      }
    ],
    evidenceCount: 1,
    evidence: [{ source: "github_issue", url: null }]
  });

  assert.equal(readiness.canBuild, true);
});

test("build readiness blocks sourced opportunities when decision says research more", () => {
  const readiness = buildReadinessForOpportunity({
    opportunity: {
      status: "researching",
      profile: { origin: "approved_research_brief", evidence_state: "source_collected" }
    },
    evaluations: [
      {
        evaluator: "decision_agent",
        scores: { recommendation: "research_more" }
      }
    ],
    evidenceCount: 3,
    evidence: [
      { source: "hn", url: "https://example.com/pain-1" },
      { source: "reddit", url: null },
      { source: "github", url: "https://github.com/acme/repo/issues/1" }
    ]
  });

  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /more research/);
});
