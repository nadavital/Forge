import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ideaConversationCanContinue } from "./ideas/conversation-state.ts";

test("closed idea conversations start a new direction instead of continuing old research", () => {
  assert.equal(ideaConversationCanContinue({ status: "active" }), true);
  assert.equal(ideaConversationCanContinue({ status: "brief_ready" }), true);
  assert.equal(ideaConversationCanContinue({ status: "researching" }), true);
  assert.equal(ideaConversationCanContinue({ status: "closed" }), false);
  assert.equal(ideaConversationCanContinue(null), false);
});

test("idea server action restarts from a closed conversation id", () => {
  const source = readFileSync(new URL("../app/actions/idea.ts", import.meta.url), "utf8");

  assert.match(source, /ideaConversationCanContinue\(conversation\)/);
  assert.match(source, /startIdeaConversation\(\{[\s\S]*projectId: input\.projectId,[\s\S]*message[\s\S]*\}\)/);
  assert.match(source, /continueIdeaConversation\(\{/);
});
