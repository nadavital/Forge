import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GENERATED_REPO_TARGET_SOURCE_TYPE,
  generatedRepoConnectionCanCreate,
  generatedRepoTargetSource,
  githubConnectionCanWriteContents,
  managedBuildGitHubTargetReadiness,
  selectBuildGitHubTarget
} from "./build/github-target.ts";
import type { DbGitHubConnection, DbProject } from "./db/types.ts";

test("connected-product build target uses the linked GitHub repo connection", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [
      {
        source_type: "github",
        connection_id: "gh_repo"
      }
    ],
    githubConnections: [githubConnection("gh_repo", "acme")]
  });

  assert.equal(target.githubConnectionId, "gh_repo");
  assert.equal(target.githubConnection?.account_login, "acme");
  assert.equal(target.generatedRepoAccountLogin, null);
});

test("connected-product build target does not use GitHub OAuth as repo access", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    sources: [
      {
        source_type: "github",
        connection_id: "gh_oauth"
      }
    ],
    githubConnections: [
      githubConnection("gh_oauth", "octocat", {
        provider: "github_oauth",
        installationId: null
      })
    ]
  });

  assert.equal(target.githubConnectionId, null);
  assert.equal(target.githubConnection, undefined);
  assert.equal(target.githubConnectionCanWrite, false);
});

test("new-product generated-repo target requires an explicit project source config", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: null }),
    sources: [],
    githubConnections: [githubConnection("gh_workspace", "workspace-org")]
  });

  assert.equal(target.githubConnectionId, null);
  assert.equal(target.githubConnection, undefined);
  assert.equal(target.generatedRepoCanCreate, false);
});

test("new-product generated-repo target uses the explicit generated repo connection", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: null }),
    sources: [
      {
        source_type: GENERATED_REPO_TARGET_SOURCE_TYPE,
        connection_id: "gh_generated"
      }
    ],
    githubConnections: [
      githubConnection("gh_workspace", "workspace-org"),
      githubConnection("gh_generated", "product-org")
    ]
  });

  assert.equal(target.githubConnectionId, "gh_generated");
  assert.equal(target.generatedRepoAccountLogin, "product-org");
  assert.equal(target.generatedRepoCanCreate, true);
});

test("new-product generated-repo target can create repos for organization installations with admin write", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: null }),
    sources: [
      {
        source_type: GENERATED_REPO_TARGET_SOURCE_TYPE,
        connection_id: "gh_generated"
      }
    ],
    githubConnections: [
      githubConnection("gh_generated", "product-org", { accountType: "Organization" })
    ]
  });

  assert.equal(target.githubConnectionId, "gh_generated");
  assert.equal(target.generatedRepoAccountLogin, "product-org");
  assert.equal(target.generatedRepoCanCreate, true);
});

test("new-product GitHub App user targets require a pre-created generated repo", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: null }),
    sources: [
      {
        source_type: GENERATED_REPO_TARGET_SOURCE_TYPE,
        connection_id: "gh_generated"
      }
    ],
    githubConnections: [
      githubConnection("gh_generated", "octocat", {
        accountType: "User",
        provider: "github_app"
      })
    ]
  });

  assert.equal(target.githubConnectionId, "gh_generated");
  assert.equal(target.generatedRepoAccountLogin, "octocat");
  assert.equal(target.generatedRepoCanCreate, false);
});

test("new-product GitHub OAuth user targets can create generated repos", () => {
  const target = selectBuildGitHubTarget({
    project: projectFixture({ repo_url: null }),
    sources: [
      {
        source_type: GENERATED_REPO_TARGET_SOURCE_TYPE,
        connection_id: "gh_generated"
      }
    ],
    githubConnections: [
      githubConnection("gh_generated", "octocat", {
        accountType: "User",
        provider: "github_oauth",
        installationId: null
      })
    ]
  });

  assert.equal(target.githubConnectionId, "gh_generated");
  assert.equal(target.generatedRepoAccountLogin, "octocat");
  assert.equal(target.generatedRepoCanCreate, true);
});

test("generated repo target source preserves repo creation capability metadata", () => {
  const source = generatedRepoTargetSource({
    id: "src_1",
    projectId: "project_1",
    connectionId: "gh_user",
    accountLogin: "octocat",
    repoCreation: "precreated_only",
    now: "2026-05-25T00:00:00.000Z"
  });

  assert.equal(source.source_type, GENERATED_REPO_TARGET_SOURCE_TYPE);
  assert.equal(source.config?.account_login, "octocat");
  assert.equal(source.config?.repo_creation, "precreated_only");
});

test("generated repo creation capability distinguishes OAuth, org App, and user App", () => {
  assert.equal(
    generatedRepoConnectionCanCreate(githubConnection("gh_org", "acme", { accountType: "Organization" })),
    true
  );
  assert.equal(
    generatedRepoConnectionCanCreate(githubConnection("gh_org_no_admin", "acme", {
      accountType: "Organization",
      scopes: ["metadata", "contents:write"]
    })),
    false
  );
  assert.equal(
    generatedRepoConnectionCanCreate(githubConnection("gh_user_app", "octocat", { accountType: "User" })),
    false
  );
  assert.equal(
    generatedRepoConnectionCanCreate(githubConnection("gh_oauth", "octocat", {
      accountType: "User",
      provider: "github_oauth",
      installationId: null
    })),
    true
  );
});

test("GitHub App PR capability requires Contents write", () => {
  assert.equal(
    githubConnectionCanWriteContents(githubConnection("gh_write", "acme", {
      scopes: ["metadata", "contents:write", "administration:write"]
    })),
    true
  );
  assert.equal(
    githubConnectionCanWriteContents(githubConnection("gh_read", "acme", {
      scopes: ["metadata", "contents:read", "issues:read"]
    })),
    false
  );
  assert.equal(
    githubConnectionCanWriteContents(githubConnection("gh_oauth", "octocat", {
      provider: "github_oauth",
      installationId: null,
      scopes: []
    })),
    true
  );
});

test("GitHub App and OAuth connections are keyed separately for the same account", () => {
  const repository = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../../supabase/migrations/0015_github_connections_provider_scope.sql", import.meta.url),
    "utf8"
  );

  assert.match(repository, /owner_user_id=eq\.\$\{encodeURIComponent\(identity\.userId\)\}&provider=eq\./);
  assert.match(repository, /row\.provider === \(input\.provider \?\? "github_app"\)/);
  assert.match(migration, /drop constraint if exists github_connections_owner_user_id_account_login_key/);
  assert.match(migration, /owner_user_id, provider, account_login/);
});

test("managed build target readiness requires a real GitHub target before env fallback", () => {
  const project = projectFixture({ repo_url: "https://github.com/acme/app" });
  const missingTarget = selectBuildGitHubTarget({
    project,
    sources: [{ source_type: "github", connection_id: null }],
    githubConnections: []
  });

  const blocked = managedBuildGitHubTargetReadiness({
    project,
    target: missingTarget,
    env: { FORGE_GITHUB_TOKEN: "broad_token" }
  });
  assert.equal(blocked.canCreatePr, false);
  assert.match(blocked.reason, /Connect this repository/);

  const fallback = managedBuildGitHubTargetReadiness({
    project,
    target: missingTarget,
    env: {
      FORGE_GITHUB_TOKEN: "broad_token",
      FORGE_ALLOW_GITHUB_TOKEN_FALLBACK: "1"
    }
  });
  assert.equal(fallback.canCreatePr, true);
  assert.match(fallback.reason, /explicit local development/);

  const hostedFallback = managedBuildGitHubTargetReadiness({
    project,
    target: missingTarget,
    env: {
      FORGE_GITHUB_TOKEN: "broad_token",
      FORGE_ALLOW_GITHUB_TOKEN_FALLBACK: "1",
      FORGE_REQUIRE_AUTH: "1"
    }
  });
  assert.equal(hostedFallback.canCreatePr, false);
  assert.match(hostedFallback.reason, /Connect this repository/);
});

test("managed existing-repo build readiness rejects OAuth source targets", () => {
  const readiness = managedBuildGitHubTargetReadiness({
    project: projectFixture({ repo_url: "https://github.com/acme/app" }),
    target: {
      githubConnectionId: "gh_oauth",
      githubConnection: githubConnection("gh_oauth", "octocat", {
        provider: "github_oauth",
        installationId: null
      }),
      githubConnectionCanWrite: true
    }
  });

  assert.equal(readiness.canCreatePr, false);
  assert.match(readiness.reason, /GitHub App installation/);
});

test("managed generated-repo builds require an explicit generated repo target", () => {
  const project = projectFixture({ repo_url: null });
  const missingTarget = selectBuildGitHubTarget({
    project,
    sources: [],
    githubConnections: [githubConnection("gh_workspace", "workspace-org")]
  });

  const blocked = managedBuildGitHubTargetReadiness({
    project,
    target: missingTarget,
    env: {}
  });
  assert.equal(blocked.canCreatePr, false);
  assert.match(blocked.reason, /generated-repo GitHub target/);

  const target = selectBuildGitHubTarget({
    project,
    sources: [{ source_type: GENERATED_REPO_TARGET_SOURCE_TYPE, connection_id: "gh_generated" }],
    githubConnections: [githubConnection("gh_generated", "product-org")]
  });
  assert.equal(managedBuildGitHubTargetReadiness({ project, target, env: {} }).canCreatePr, true);
});

test("managed build target readiness blocks stored GitHub connections without Contents write", () => {
  const connectedProject = projectFixture({ repo_url: "https://github.com/acme/app" });
  const connectedTarget = selectBuildGitHubTarget({
    project: connectedProject,
    sources: [{ source_type: "github", connection_id: "gh_read" }],
    githubConnections: [
      githubConnection("gh_read", "acme", {
        scopes: ["metadata", "contents:read", "issues:read"]
      })
    ]
  });

  const connectedReadiness = managedBuildGitHubTargetReadiness({
    project: connectedProject,
    target: connectedTarget,
    env: {}
  });
  assert.equal(connectedReadiness.canCreatePr, false);
  assert.match(connectedReadiness.reason, /Contents write/);

  const newProject = projectFixture({ repo_url: null });
  const generatedTarget = selectBuildGitHubTarget({
    project: newProject,
    sources: [{ source_type: GENERATED_REPO_TARGET_SOURCE_TYPE, connection_id: "gh_read" }],
    githubConnections: [
      githubConnection("gh_read", "acme", {
        scopes: ["metadata", "contents:read", "issues:read"]
      })
    ]
  });

  const generatedReadiness = managedBuildGitHubTargetReadiness({
    project: newProject,
    target: generatedTarget,
    env: {}
  });
  assert.equal(generatedReadiness.canCreatePr, false);
  assert.match(generatedReadiness.reason, /Contents write/);
});

function projectFixture(overrides: Partial<DbProject>): DbProject {
  return {
    id: "project_1",
    name: "Project",
    mode: "new_product",
    ...overrides
  };
}

function githubConnection(
  id: string,
  accountLogin: string,
  options: {
    accountType?: "User" | "Organization";
    provider?: DbGitHubConnection["provider"];
    installationId?: string | null;
    scopes?: string[];
  } = {}
): DbGitHubConnection {
  return {
    id,
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    provider: options.provider ?? "github_app",
    account_login: accountLogin,
    account_type: options.accountType ?? "Organization",
    installation_id: options.installationId === undefined ? "123" : options.installationId,
    scopes: options.scopes ?? ["metadata", "contents:write", "administration:write"],
    status: "active"
  };
}
