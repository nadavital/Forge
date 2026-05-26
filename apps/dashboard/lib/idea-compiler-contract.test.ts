import assert from "node:assert/strict";
import test from "node:test";
import {
  compilerFailureBrief,
  compilerPrompt,
  normalizeResearchBriefPayload,
  offlineCompilerBrief
} from "./ideas/idea-compiler-contract.ts";
import type { DbIdeaMessage } from "./db/types.ts";

test("idea compiler prompt requires natural conversation instead of fixed questions", () => {
  const prompt = compilerPrompt([
    {
      id: "msg_1",
      conversation_id: "conv_1",
      role: "user",
      content: "Maybe Forge should help me turn vague ideas into researched build directions."
    }
  ]);

  assert.match(prompt, /Do not use a fixed questionnaire/);
  assert.match(prompt, /one or two highest-leverage questions/);
  assert.match(prompt, /"ready_for_research"/);
  assert.match(prompt, /disqualifying_evidence/);
});

test("idea compiler failures become durable needs-context briefs", () => {
  const messages: DbIdeaMessage[] = [
    {
      id: "msg_1",
      conversation_id: "conv_1",
      role: "user",
      content: "Explore an AI research copilot for solo founders."
    }
  ];

  const result = compilerFailureBrief({
    projectId: "project_1",
    conversationId: "conv_1",
    messages,
    error: new Error("Managed idea compiler did not return JSON")
  });

  assert.equal(result.brief.status, "needs_context");
  assert.equal(result.brief.hypothesis, "Explore an AI research copilot for solo founders.");
  assert.equal(result.brief.confidence, 0);
  assert.match(result.brief.open_questions.join(" "), /Who specifically|concrete painful moment/);
  assert.match(result.brief.constraints.join(" "), /Idea compiler error/);
  assert.match(result.assistantMessage, /saved/);
});

test("offline idea compiler keeps product follow-ups instead of a configuration-only dead end", () => {
  const result = offlineCompilerBrief({
    projectId: "project_1",
    conversationId: "conv_1",
    messages: [
      {
        id: "msg_1",
        conversation_id: "conv_1",
        role: "user",
        content: "Maybe there is a tool for turning product chats into real market research."
      }
    ]
  });

  assert.equal(result.brief.status, "needs_context");
  assert.match(result.brief.hypothesis, /product chats/);
  assert.match(result.brief.open_questions.join(" "), /Who specifically|concrete painful moment/);
  assert.doesNotMatch(result.brief.open_questions.join(" "), /AI intake is not configured/i);
  assert.match(result.brief.constraints.join(" "), /AI intake is not configured/);
});

test("idea compiler downgrades incomplete ready briefs before approval", () => {
  const brief = normalizeResearchBriefPayload({
    projectId: "project_1",
    conversationId: "conv_1",
    payload: {
      brief: {
        status: "ready_for_research",
        hypothesis: "Solo founders need better idea validation",
        target_users: ["solo founders"],
        confidence: 0.8
      }
    }
  });

  assert.equal(brief.status, "needs_context");
  assert.equal(brief.open_questions.length, 2);
  assert.match(brief.open_questions.join(" "), /solo founders/);
  assert.match(brief.open_questions.join(" "), /concrete painful moment|Where have you seen/);
  assert.doesNotMatch(brief.open_questions.join(" "), /Which public sources should the research agents inspect/);
  assert.doesNotMatch(brief.open_questions.join(" "), /What is inside and outside the v1 MVP boundary/);
});

test("idea compiler preserves complete ready briefs", () => {
  const brief = normalizeResearchBriefPayload({
    projectId: "project_1",
    conversationId: "conv_1",
    payload: {
      assistant_message: "This is ready to research.",
      brief: {
        status: "ready_for_research",
        hypothesis: "Solo iOS developers need a lighter App Store screenshot workflow",
        target_users: ["solo iOS developers"],
        pain_area: "Screenshot production is repetitive and error-prone.",
        source_plan: ["GitHub issues about App Store screenshot automation"],
        disqualifying_evidence: ["Existing free tools solve planning, capture, framing, and export"],
        mvp_boundaries: ["Local screenshot planner only"],
        confidence: 0.64
      }
    }
  });

  assert.equal(brief.status, "ready_for_research");
  assert.deepEqual(brief.open_questions, []);
});
