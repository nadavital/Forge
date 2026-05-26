import assert from "node:assert/strict";
import test from "node:test";
import { projectBuildReadiness } from "./build/project-readiness.ts";
import type { DbGitHubConnection, DbProject } from "./db/types.ts";

test("project build readiness uses simulated builder without a GitHub target when Gemini is absent", () => {
  const readiness = projectBuildReadiness({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [{ source_type: "github", connection_id: null }],
    githubConnections: [],
    env: {}
  });

  assert.equal(readiness.adapter, "simulated");
  assert.equal(readiness.canBuild, true);
});

test("forced managed project build readiness requires Gemini before creating build rows", () => {
  const readiness = projectBuildReadiness({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [{ source_type: "github", connection_id: "gh_1" }],
    githubConnections: [githubConnection({ scopes: ["metadata", "contents:write"] })],
    env: { FORGE_BUILDER_ADAPTER: "managed" }
  });

  assert.equal(readiness.adapter, "managed");
  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /GEMINI_API_KEY/);
});

test("managed project build readiness blocks missing connected-repo GitHub targets", () => {
  const readiness = projectBuildReadiness({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [{ source_type: "github", connection_id: null }],
    githubConnections: [],
    env: { GEMINI_API_KEY: "test-key" }
  });

  assert.equal(readiness.adapter, "managed");
  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /Connect this repository/);
});

test("managed project build readiness blocks GitHub App targets without Contents write", () => {
  const readiness = projectBuildReadiness({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [{ source_type: "github", connection_id: "gh_1" }],
    githubConnections: [githubConnection({ scopes: ["metadata", "contents:read", "issues:read"] })],
    env: { GEMINI_API_KEY: "test-key" }
  });

  assert.equal(readiness.adapter, "managed");
  assert.equal(readiness.canBuild, false);
  assert.match(readiness.reason, /Contents write/);
});

test("managed project build readiness accepts writable project-linked GitHub targets", () => {
  const readiness = projectBuildReadiness({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [{ source_type: "github", connection_id: "gh_1" }],
    githubConnections: [githubConnection({ scopes: ["metadata", "contents:write"] })],
    env: { GEMINI_API_KEY: "test-key" }
  });

  assert.equal(readiness.adapter, "managed");
  assert.equal(readiness.canBuild, true);
});

function projectFixture(overrides: Partial<DbProject>): DbProject {
  return {
    id: "project_1",
    name: "Project",
    mode: "connected_product",
    ...overrides
  };
}

function githubConnection(
  overrides: {
    scopes?: string[];
  } = {}
): DbGitHubConnection {
  return {
    id: "gh_1",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    provider: "github_app",
    account_login: "acme",
    account_type: "Organization",
    installation_id: "999",
    scopes: overrides.scopes ?? ["metadata", "contents:write", "administration:write"],
    status: "active"
  };
}
