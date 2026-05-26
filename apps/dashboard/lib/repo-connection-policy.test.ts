import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  connectedRepoDiscoveryRequiresConnection,
  githubConnectionCanLinkRepository
} from "./github/repo-connection-policy.ts";

test("hosted connected-product discovery requires an active scoped GitHub connection", () => {
  assert.equal(
    connectedRepoDiscoveryRequiresConnection({
      repoUrl: "https://github.com/acme/app",
      connection: undefined,
      env: { FORGE_REQUIRE_AUTH: "1" }
    }),
    true
  );
  assert.equal(
    connectedRepoDiscoveryRequiresConnection({
      repoUrl: "https://github.com/acme/app",
      connection: { status: "needs_reauth" },
      env: { FORGE_REQUIRE_AUTH: "1" }
    }),
    true
  );
  assert.equal(
    connectedRepoDiscoveryRequiresConnection({
      repoUrl: "https://github.com/acme/app",
      connection: { provider: "github_oauth", status: "active" },
      env: { FORGE_REQUIRE_AUTH: "1" }
    }),
    true
  );
  assert.equal(
    connectedRepoDiscoveryRequiresConnection({
      repoUrl: "https://github.com/acme/app",
      connection: { provider: "github_app", installation_id: null, status: "active" },
      env: { FORGE_REQUIRE_AUTH: "1" }
    }),
    true
  );
  assert.equal(
    connectedRepoDiscoveryRequiresConnection({
      repoUrl: "https://github.com/acme/app",
      connection: { provider: "github_app", installation_id: "123", status: "active" },
      env: { FORGE_REQUIRE_AUTH: "1" }
    }),
    false
  );
});

test("local connected-product discovery can still inspect public repos without a connection", () => {
  assert.equal(
    connectedRepoDiscoveryRequiresConnection({
      repoUrl: "https://github.com/acme/app",
      connection: undefined,
      env: { FORGE_REQUIRE_AUTH: "0" }
    }),
    false
  );
});

test("repository linking requires an active usable GitHub connection", () => {
  assert.deepEqual(githubConnectionCanLinkRepository(undefined), {
    ok: false,
    reason: "Choose a valid GitHub connection."
  });
  assert.deepEqual(
    githubConnectionCanLinkRepository({
      provider: "github_app",
      installation_id: "123",
      status: "needs_reauth"
    }),
    {
      ok: false,
      reason: "Reconnect this GitHub connection before linking a repository."
    }
  );
  assert.deepEqual(
    githubConnectionCanLinkRepository({
      provider: "github_app",
      installation_id: null,
      status: "active"
    }),
    {
      ok: false,
      reason: "Reconnect this GitHub App installation before linking a repository."
    }
  );
  assert.deepEqual(
    githubConnectionCanLinkRepository({
      provider: "github_app",
      installation_id: "123",
      status: "active"
    }),
    { ok: true }
  );
  assert.deepEqual(
    githubConnectionCanLinkRepository({
      provider: "github_oauth",
      status: "active"
    }),
    {
      ok: false,
      reason: "Use a GitHub App installation to link project repositories. GitHub user OAuth is only for generated repo targets."
    }
  );
});

test("GitHub repository link action enforces the server-side connection policy", () => {
  const action = readFileSync(new URL("../app/actions/github.ts", import.meta.url), "utf8");
  const linkActionBody = action.slice(
    action.indexOf("export async function linkGitHubRepository"),
    action.indexOf("export async function useGitHubConnectionForGeneratedRepos")
  );

  assert.match(linkActionBody, /githubConnectionCanLinkRepository/);
  assert.match(linkActionBody, /linkPolicy\.ok/);
});
