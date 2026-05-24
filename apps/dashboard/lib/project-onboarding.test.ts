import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOnboardingChecklist,
  buildProjectDefaults,
  githubSourcePatch,
  normalizeGithubRepository,
  onboardingStatus
} from "./project-onboarding.ts";

test("normalizes supported GitHub repository inputs", () => {
  assert.deepEqual(normalizeGithubRepository("nadavital/Forge"), {
    owner: "nadavital",
    repo: "Forge",
    repoUrl: "https://github.com/nadavital/Forge"
  });
  assert.deepEqual(normalizeGithubRepository("git@github.com:nadavital/Forge.git"), {
    owner: "nadavital",
    repo: "Forge",
    repoUrl: "https://github.com/nadavital/Forge"
  });
  assert.equal(normalizeGithubRepository("https://example.com/nadavital/Forge"), null);
});

test("connected product onboarding creates manual, GitHub, feedback, and trigger contracts", () => {
  let counter = 0;
  const defaults = buildProjectDefaults({
    projectId: "proj_1",
    mode: "connected_product",
    name: "Forge",
    repoUrl: "https://github.com/nadavital/Forge.git",
    description: "Product-first agent system",
    idFactory: (prefix) => `${prefix}_${++counter}`,
    now: "2026-05-23T12:00:00.000Z"
  });

  assert.equal(defaults.project.repo_url, "https://github.com/nadavital/Forge");
  assert.equal(defaults.sources.find((source) => source.source_type === "manual")?.status, "active");
  assert.equal(defaults.sources.find((source) => source.source_type === "github")?.status, "active");
  assert.equal(defaults.sources.find((source) => source.source_type === "feedback_form")?.status, "paused");
  assert.equal(defaults.triggers.find((trigger) => trigger.trigger_type === "manual")?.status, "active");
  assert.equal(defaults.triggers.find((trigger) => trigger.trigger_type === "schedule")?.status, "active");
  assert.equal(defaults.triggers.find((trigger) => trigger.trigger_type === "schedule")?.config?.interval_hours, 24);
});

test("checklist reports incomplete GitHub setup until a repo is connected", () => {
  let counter = 0;
  const defaults = buildProjectDefaults({
    projectId: "proj_2",
    mode: "new_product",
    name: "New thing",
    description: "A product concept",
    idFactory: (prefix) => `${prefix}_${++counter}`
  });

  const pendingItems = buildOnboardingChecklist({
    project: defaults.project,
    sources: defaults.sources,
    triggers: defaults.triggers,
    preference: defaults.preference
  });

  assert.equal(onboardingStatus(pendingItems), "needs_setup");

  const patch = githubSourcePatch("nadavital/new-thing");
  assert.ok(patch);
  const sources = defaults.sources.map((source) =>
    source.source_type === "github" ? { ...source, ...patch } : source
  );

  const completeItems = buildOnboardingChecklist({
    project: { ...defaults.project, repo_url: "https://github.com/nadavital/new-thing" },
    sources,
    triggers: defaults.triggers,
    preference: defaults.preference
  });

  assert.equal(onboardingStatus(completeItems), "complete");
});
