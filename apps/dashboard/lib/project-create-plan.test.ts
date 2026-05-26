import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planProjectCreation } from "./project-create-plan.ts";

test("blank GitHub input creates a true new-product project without repo creation", () => {
  const plan = planProjectCreation({ repoUrl: "   " });

  assert.deepEqual(plan, {
    ok: true,
    mode: "new_product",
    repoUrl: null,
    shouldRunInitialPipeline: false,
    shouldStartIdeaConversation: true,
    shouldConnectGitHubFirst: false
  });
});

test("GitHub input creates a connected-product project and normalizes the repo", () => {
  const plan = planProjectCreation({ repoUrl: "git@github.com:nadavital/Forge.git" });

  assert.deepEqual(plan, {
    ok: true,
    mode: "connected_product",
    repoUrl: "https://github.com/nadavital/Forge",
    shouldRunInitialPipeline: true,
    shouldStartIdeaConversation: false,
    shouldConnectGitHubFirst: false
  });
});

test("hosted GitHub input waits for scoped GitHub connection before initial discovery", () => {
  const plan = planProjectCreation({
    repoUrl: "nadavital/Forge",
    env: { FORGE_REQUIRE_AUTH: "1" }
  });

  assert.deepEqual(plan, {
    ok: true,
    mode: "connected_product",
    repoUrl: "https://github.com/nadavital/Forge",
    shouldRunInitialPipeline: false,
    shouldStartIdeaConversation: false,
    shouldConnectGitHubFirst: true
  });
});

test("non-GitHub repo input is rejected before project creation", () => {
  const plan = planProjectCreation({ repoUrl: "https://example.com/not/github" });

  assert.equal(plan.ok, false);
});

test("new-product project creation seeds the AI idea conversation from freeform input", () => {
  const actionSource = readFileSync(new URL("../app/actions/project.ts", import.meta.url), "utf8");
  const formSource = readFileSync(new URL("../components/onboarding/NewProjectForm.tsx", import.meta.url), "utf8");

  assert.match(formSource, /name="initialIdea"/);
  assert.match(formSource, /first message in the AI idea conversation/);
  assert.doesNotMatch(formSource, /name="markets"/);
  assert.doesNotMatch(formSource, /name="riskTolerance"/);
  assert.doesNotMatch(formSource, /name="scheduleCadence"/);
  assert.doesNotMatch(formSource, /name="notes"/);
  assert.doesNotMatch(formSource, /Project context/);
  assert.match(actionSource, /startIdeaConversation/);
  assert.match(actionSource, /plan\.shouldStartIdeaConversation/);
  assert.match(actionSource, /input\.initialIdea\.trim\(\)/);
});
