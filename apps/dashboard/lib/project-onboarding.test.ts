import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOnboardingChecklist,
  buildProjectDefaults,
  githubSourcePatch,
  normalizeGithubRepository,
  onboardingStatus,
  sourceStatusForSettings
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

test("hosted connected product defaults keep GitHub source paused until a scoped connection is linked", () => {
  let counter = 0;
  const defaults = buildProjectDefaults({
    projectId: "proj_hosted",
    mode: "connected_product",
    name: "Forge",
    repoUrl: "https://github.com/nadavital/Forge.git",
    githubConnectionRequired: true,
    description: "Product-first agent system",
    idFactory: (prefix) => `${prefix}_${++counter}`,
    now: "2026-05-23T12:00:00.000Z"
  });
  const githubSource = defaults.sources.find((source) => source.source_type === "github");

  assert.equal(defaults.project.repo_url, "https://github.com/nadavital/Forge");
  assert.equal(githubSource?.status, "paused");
  assert.equal(githubSource?.config?.needs_connection, true);
});

test("source settings keep GitHub sources paused until a scoped connection is linked", () => {
  assert.equal(
    sourceStatusForSettings(
      {
        source_type: "github",
        connection_id: null,
        config: { needs_connection: true }
      },
      "active"
    ),
    "paused"
  );
  assert.equal(
    sourceStatusForSettings(
      {
        source_type: "github",
        connection_id: "gh_1",
        config: { needs_connection: true }
      },
      "active"
    ),
    "active"
  );
  assert.equal(
    sourceStatusForSettings(
      {
        source_type: "manual",
        connection_id: null,
        config: { origin: "settings" }
      },
      "active"
    ),
    "active"
  );
});

test("connected-product checklist reports incomplete GitHub setup until a scoped connection is linked", () => {
  let counter = 0;
  const defaults = buildProjectDefaults({
    projectId: "proj_2",
    mode: "connected_product",
    name: "Existing thing",
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

  const repoOnlyItems = buildOnboardingChecklist({
    project: { ...defaults.project, repo_url: "https://github.com/nadavital/new-thing" },
    sources: defaults.sources.map((source) =>
      source.source_type === "github" ? { ...source, ...githubSourcePatch("nadavital/new-thing")! } : source
    ),
    triggers: defaults.triggers,
    preference: defaults.preference
  });
  assert.equal(repoOnlyItems.find((item) => item.id === "github")?.complete, false);

  const patch = githubSourcePatch("nadavital/new-thing");
  assert.ok(patch);
  const sources = defaults.sources.map((source) =>
    source.source_type === "github" ? { ...source, ...patch, connection_id: "gh_1" } : source
  );

  const completeItems = buildOnboardingChecklist({
    project: { ...defaults.project, repo_url: "https://github.com/nadavital/new-thing" },
    sources,
    triggers: defaults.triggers,
    preference: defaults.preference
  });

  assert.equal(onboardingStatus(completeItems), "complete");
});

test("new-product checklist does not require a GitHub repo before AI idea intake", () => {
  let counter = 0;
  const defaults = buildProjectDefaults({
    projectId: "proj_3",
    mode: "new_product",
    name: "New thing",
    description: "A product concept",
    idFactory: (prefix) => `${prefix}_${++counter}`
  });

  const items = buildOnboardingChecklist({
    project: defaults.project,
    sources: defaults.sources,
    triggers: defaults.triggers,
    preference: defaults.preference
  });

  assert.equal(defaults.project.repo_url, null);
  assert.equal(items.find((item) => item.id === "github")?.complete, true);
  assert.equal(onboardingStatus(items), "complete");
});
