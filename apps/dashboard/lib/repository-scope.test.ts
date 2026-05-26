import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  conversationBelongsToProject,
  githubConnectionUsableForProject,
  githubConnectionVisibleToProject,
  opportunityBelongsToProject,
  projectChildBelongsToProject,
  projectVisibleToIdentity,
  researchBriefBelongsToProject,
  visibleProjectIdsForIdentity
} from "./db/identity-scope.ts";

test("project scope allows only the active workspace identity when ownership is present", () => {
  const identity = { userId: "user_active", workspaceId: "workspace_active" };

  assert.equal(
    projectVisibleToIdentity(
      { owner_user_id: "user_active", workspace_id: "workspace_active" },
      identity
    ),
    true
  );
  assert.equal(
    projectVisibleToIdentity(
      { owner_user_id: "user_other", workspace_id: "workspace_other" },
      identity
    ),
    false
  );
});

test("project scope keeps legacy local rows without ownership visible", () => {
  assert.equal(projectVisibleToIdentity({}, { userId: "user_active", workspaceId: "workspace_active" }), true);
});

test("visible project ids follow the active workspace identity", () => {
  const visible = visibleProjectIdsForIdentity(
    [
      { id: "owned", owner_user_id: "user_active" },
      { id: "workspace", workspace_id: "workspace_active" },
      { id: "other", workspace_id: "workspace_other" },
      { id: "legacy" }
    ],
    { userId: "user_active", workspaceId: "workspace_active" }
  );

  assert.deepEqual([...visible].sort(), ["legacy", "owned", "workspace"]);
});

test("project scope rejects raw project ids outside the active identity", () => {
  const identity = { userId: "user_active", workspaceId: "workspace_active" };

  assert.equal(projectVisibleToIdentity({ owner_user_id: "user_active" }, identity), true);
  assert.equal(projectVisibleToIdentity({ owner_user_id: "user_other" }, identity), false);
  assert.equal(projectVisibleToIdentity({ workspace_id: "workspace_active" }, identity), true);
  assert.equal(projectVisibleToIdentity({ workspace_id: "workspace_other" }, identity), false);
});

test("GitHub connection visibility follows generated repo target source links", () => {
  assert.equal(
    githubConnectionVisibleToProject({
      projectId: "project_generated",
      project: {
        owner_user_id: "local-user",
        workspace_id: null
      },
      connection: {
        id: "gh_generated",
        workspace_id: null
      },
      sources: [
        {
          project_id: "project_generated",
          connection_id: "gh_generated"
        }
      ]
    }),
    true
  );
});

test("GitHub connection writes require the active user's project scope", () => {
  const identity = { userId: "user_active", workspaceId: "workspace_active" };
  const project = { owner_user_id: "user_active", workspace_id: "workspace_active" };

  assert.equal(
    githubConnectionUsableForProject({
      projectId: "project_a",
      project,
      identity,
      connection: {
        id: "gh_workspace",
        owner_user_id: "user_other",
        workspace_id: "workspace_active"
      },
      sources: []
    }),
    true
  );

  assert.equal(
    githubConnectionUsableForProject({
      projectId: "project_a",
      project,
      identity,
      connection: {
        id: "gh_user",
        owner_user_id: "user_active",
        workspace_id: "workspace_other"
      },
      sources: []
    }),
    true
  );

  assert.equal(
    githubConnectionUsableForProject({
      projectId: "project_a",
      project,
      identity,
      connection: {
        id: "gh_other",
        owner_user_id: "user_other",
        workspace_id: "workspace_other"
      },
      sources: []
    }),
    false
  );
});

test("opportunity writes must stay inside the submitted project scope", () => {
  assert.equal(opportunityBelongsToProject({ project_id: "project_a" }, "project_a"), true);
  assert.equal(opportunityBelongsToProject({ project_id: "project_b" }, "project_a"), false);
  assert.equal(opportunityBelongsToProject({ project_id: null }, "project_a"), false);
  assert.equal(opportunityBelongsToProject(undefined, "project_a"), false);
});

test("idea intake writes must stay inside the submitted project scope", () => {
  assert.equal(conversationBelongsToProject({ project_id: "project_a" }, "project_a"), true);
  assert.equal(conversationBelongsToProject({ project_id: "project_b" }, "project_a"), false);
  assert.equal(researchBriefBelongsToProject({ project_id: "project_a" }, "project_a"), true);
  assert.equal(researchBriefBelongsToProject({ project_id: "project_b" }, "project_a"), false);
});

test("project child writes must stay inside the submitted project scope", () => {
  assert.equal(projectChildBelongsToProject({ project_id: "project_a" }, "project_a"), true);
  assert.equal(projectChildBelongsToProject({ project_id: "project_b" }, "project_a"), false);
  assert.equal(projectChildBelongsToProject({ project_id: null }, "project_a"), false);
  assert.equal(projectChildBelongsToProject(undefined, "project_a"), false);
});

test("generic Supabase store loads scope project and token reads before loading child rows", () => {
  const repository = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
  const loadStoreBody = repository.slice(
    repository.indexOf("export async function loadStore"),
    repository.indexOf("async function mutateStore")
  );

  assert.match(loadStoreBody, /function selectVisibleProjects/);
  assert.match(loadStoreBody, /owner_user_id=eq\./);
  assert.match(loadStoreBody, /workspace_id=eq\./);
  assert.doesNotMatch(loadStoreBody, /safeSelect<DbProject>\(\s*supabase,\s*"projects",\s*"select=\*"/);
  assert.doesNotMatch(loadStoreBody, /"github_user_tokens"/);
  assert.match(loadStoreBody, /github_user_tokens:\s*\[\]/);
});

test("hosted active identity resolves auth subjects before local defaults", () => {
  const repository = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
  const identityBody = repository.slice(
    repository.indexOf("export async function getActiveIdentity"),
    repository.indexOf("function ensureLocalIdentity")
  );

  assert.match(identityBody, /FORGE_AUTH_SUBJECT/);
  assert.match(identityBody, /resolveSupabaseAuthSubjectIdentity/);
  assert.match(identityBody, /provider=eq\.supabase/);
  assert.match(identityBody, /workspace_members/);
  assert.match(identityBody, /owner_user_id=eq\./);
  assert.match(identityBody, /envUserId \?\? "local-user"/);
});

test("project settings cannot bypass GitHub connection linking with a raw repo URL", () => {
  const settingsAction = readFileSync(new URL("../app/actions/settings.ts", import.meta.url), "utf8");
  const settingsForm = readFileSync(
    new URL("../components/settings/ProjectSettingsForm.tsx", import.meta.url),
    "utf8"
  );
  const repository = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
  const updateSettingsBody = repository.slice(
    repository.indexOf("export async function updateProjectSettings"),
    repository.indexOf("export async function markTriggerRan")
  );

  assert.doesNotMatch(settingsAction, /repoUrl/);
  assert.doesNotMatch(settingsForm, /name="repoUrl"/);
  assert.doesNotMatch(updateSettingsBody, /repo_url:/);
  assert.doesNotMatch(updateSettingsBody, /githubSourcePatch/);
  assert.match(updateSettingsBody, /product_url: input\.project\.product_url/);
  assert.match(updateSettingsBody, /sourceStatusForSettings/);
  assert.match(updateSettingsBody, /assertSourceConfigBelongsToProject/);
});
