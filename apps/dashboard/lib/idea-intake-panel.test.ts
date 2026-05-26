import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("idea intake panel surfaces model-generated open questions instead of fixed prompts", () => {
  const source = readFileSync(
    new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /brief\?\.status === "needs_context"/);
  assert.match(source, /brief\.openQuestions\.filter\(Boolean\)\.slice\(0, 3\)/);
  assert.match(source, /placeholder=\{composerPlaceholder\}/);
  assert.match(source, /label="Next" items=\{openQuestions\}/);
  assert.doesNotMatch(source, /prebuilt|fixed questionnaire/i);
});

test("idea intake panel shows brief readiness without fixed questions", () => {
  const source = readFileSync(
    new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /BriefReadinessSummary/);
  assert.match(source, /Brief readiness/);
  assert.match(source, /missingBriefSections/);
  assert.match(source, /Ready for source-backed research/);
  assert.match(source, /Needs more product context/);
  assert.match(source, /AI confidence/);
  assert.doesNotMatch(source, /questionnaire/i);
});

test("idea intake panel surfaces research evidence sufficiency from the latest run", () => {
  const source = readFileSync(
    new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /conversation\?\.latestResearchRun\?\.evidenceSummary/);
  assert.match(source, /ResearchEvidenceStatus/);
  assert.match(source, /Research evidence status/);
  assert.match(source, /summary\.label/);
  assert.match(source, /summary\.detail/);
});

test("idea intake panel surfaces source-plan routing audit from research metadata", () => {
  const source = readFileSync(
    new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /summary\.sourceAudit/);
  assert.match(source, /Collected:/);
  assert.match(source, /Planned:/);
  assert.match(source, /Targets:/);
});

test("idea intake panel summarizes approved-brief agent research progress", () => {
  const source = readFileSync(
    new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /ResearchAgentProgress/);
  assert.match(source, /Research agent progress/);
  assert.match(source, /Agent research/);
  assert.match(source, /completed \/ Math\.max\(tasks\.length, 1\)/);
  assert.match(source, /task\.phase/);
  assert.match(source, /task\.role/);
});

test("idea intake starts a fresh direction after a research conversation closes", () => {
  const source = readFileSync(
    new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /ideaConversationCanContinue\(conversation\)/);
  assert.match(source, /canContinueConversation \? conversation\?\.id : undefined/);
  assert.match(source, /This research thread is complete/);
  assert.match(source, /What should Forge explore next\?/);
});
