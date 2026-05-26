import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGitHubPrFromFiles, resolveGitHubTokenForBuildTarget } from "./build/github-pr.ts";
import type { BuildBrief } from "./build/brief.ts";
import type { DbGitHubConnection } from "./db/types.ts";

test("existing-repo PRs prefer short-lived GitHub App installation tokens", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousToken = process.env.GITHUB_TOKEN;
  const previousAllowFallback = process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.FORGE_GITHUB_TOKEN = "env_token";
    delete process.env.GITHUB_TOKEN;

    let requestedPath = "";
    let authHeader = "";
    globalThis.fetch = (async (url, init) => {
      requestedPath = String(url);
      const headers = init?.headers as Record<string, string>;
      authHeader = headers.Authorization;
      return Response.json({ token: "installation_token" });
    }) as typeof fetch;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: existingRepoBrief(),
      githubConnection: githubConnection()
    });

    assert.equal(token, "installation_token");
    assert.equal(
      requestedPath,
      "https://api.github.com/app/installations/999/access_tokens"
    );
    assert.match(authHeader, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    restoreEnv("GITHUB_TOKEN", previousToken);
    restoreEnv("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", previousAllowFallback);
    globalThis.fetch = previousFetch;
  }
});

test("existing-repo PRs do not mint App tokens without Contents write", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousAllowFallback = process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let fetchCalled = false;

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    delete process.env.FORGE_GITHUB_TOKEN;
    delete process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ token: "installation_token" });
    }) as typeof fetch;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: existingRepoBrief(),
      githubConnection: githubConnection({ scopes: ["metadata", "contents:read", "issues:read"] })
    });

    assert.equal(token, null);
    assert.equal(fetchCalled, false);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    restoreEnv("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", previousAllowFallback);
    globalThis.fetch = previousFetch;
  }
});

test("existing-repo PRs do not silently use broad server tokens", async () => {
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousAllowFallback = process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
  const previousRequireAuth = process.env.FORGE_REQUIRE_AUTH;

  try {
    process.env.FORGE_GITHUB_TOKEN = "env_token";
    delete process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
    delete process.env.FORGE_REQUIRE_AUTH;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: existingRepoBrief(),
      githubConnection: undefined
    });

    assert.equal(token, null);
  } finally {
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    restoreEnv("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", previousAllowFallback);
    restoreEnv("FORGE_REQUIRE_AUTH", previousRequireAuth);
  }
});

test("existing-repo PRs ignore local-dev token fallback when hosted auth is required", async () => {
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousAllowFallback = process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
  const previousRequireAuth = process.env.FORGE_REQUIRE_AUTH;

  try {
    process.env.FORGE_GITHUB_TOKEN = "env_token";
    process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK = "1";
    process.env.FORGE_REQUIRE_AUTH = "1";

    const token = await resolveGitHubTokenForBuildTarget({
      brief: existingRepoBrief(),
      githubConnection: undefined
    });

    assert.equal(token, null);
  } finally {
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    restoreEnv("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", previousAllowFallback);
    restoreEnv("FORGE_REQUIRE_AUTH", previousRequireAuth);
  }
});

test("existing-repo PR access uses GitHub App installations instead of OAuth user tokens", () => {
  const source = readFileSync(new URL("./build/github-pr.ts", import.meta.url), "utf8");
  const resolver = source.slice(
    source.indexOf('if (input.brief.build_target.kind === "existing_repo_pr")'),
    source.indexOf("if (input.brief.build_target.github_connection_id)")
  );

  assert.match(resolver, /kind === "existing_repo_pr"/);
  assert.match(resolver, /input\.githubConnection\?\.provider === "github_app"/);
  assert.match(resolver, /githubConnectionCanWriteContents\(input\.githubConnection\)/);
  assert.doesNotMatch(resolver, /userAccess\(input\.githubConnection\)/);
  assert.match(resolver, /return envAccess\(\)/);
  assert.match(
    source,
    /GitHub App installation token is required to create an existing-repo PR/
  );
});

test("generated-repo PR access tries GitHub user OAuth before local-dev token fallback", () => {
  const source = readFileSync(new URL("./build/github-pr.ts", import.meta.url), "utf8");
  const resolver = source.slice(
    source.indexOf("export async function resolveGitHubAccessForBuildTarget"),
    source.indexOf("async function appAccess")
  );

  assert.match(resolver, /githubConnectionCanWriteContents\(input\.githubConnection\)/);
  assert.match(resolver, /canUseAppAccessForGeneratedRepo\(input\.brief, input\.githubConnection\)/);
  assert.match(resolver, /const user = await userAccess\(input\.githubConnection\)/);
  assert.match(resolver, /return envAccess\(\)/);
  assert.match(
    source,
    /GitHub user OAuth can create generated repositories only for the authorized user account/
  );
  assert.match(source, /return "\/user\/repos"/);
});

test("generated-repo PRs use GitHub App installation tokens for org repo creation", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.FORGE_GITHUB_TOKEN = "env_token";
    globalThis.fetch = (async () => Response.json({ token: "generated_installation_token" })) as typeof fetch;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: generatedRepoBrief({
        github_connection_id: "gh_1",
        create_repo_if_missing: true
      }),
      githubConnection: githubConnection({ accountType: "Organization" })
    });

    assert.equal(token, "generated_installation_token");
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    globalThis.fetch = previousFetch;
  }
});

test("generated-repo PRs do not use App org creation without Administration write", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousAllowFallback = process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let fetchCalled = false;

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    delete process.env.FORGE_GITHUB_TOKEN;
    delete process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ token: "generated_installation_token" });
    }) as typeof fetch;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: generatedRepoBrief({
        github_connection_id: "gh_1",
        create_repo_if_missing: true
      }),
      githubConnection: githubConnection({
        accountType: "Organization",
        scopes: ["metadata", "contents:write"]
      })
    });

    assert.equal(token, null);
    assert.equal(fetchCalled, false);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    restoreEnv("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", previousAllowFallback);
    globalThis.fetch = previousFetch;
  }
});

test("generated-repo PRs use explicit dev token fallback for user-account repo creation", async () => {
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousAllowFallback = process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK;
  const previousRequireAuth = process.env.FORGE_REQUIRE_AUTH;
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.FORGE_GITHUB_TOKEN = "generated_repo_token";
    process.env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK = "1";
    delete process.env.FORGE_REQUIRE_AUTH;
    globalThis.fetch = (async () => Response.json({ token: "installation_token" })) as typeof fetch;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: generatedRepoBrief({
        github_connection_id: "gh_user",
        generated_repo_owner: "octocat",
        create_repo_if_missing: true
      }),
      githubConnection: githubConnection({
        id: "gh_user",
        accountLogin: "octocat",
        accountType: "User"
      })
    });

    assert.equal(token, "generated_repo_token");
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    restoreEnv("FORGE_ALLOW_GITHUB_TOKEN_FALLBACK", previousAllowFallback);
    restoreEnv("FORGE_REQUIRE_AUTH", previousRequireAuth);
    globalThis.fetch = previousFetch;
  }
});

test("GitHub App org generated-repo builds create the repository before opening the PR", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requested: Array<{ url: string; method: string }> = [];
  let created = false;

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.FORGE_GITHUB_TOKEN = "env_token";
    globalThis.fetch = (async (url, init) => {
      const method = init?.method || "GET";
      requested.push({ url: String(url), method });
      if (String(url).endsWith("/app/installations/999/access_tokens")) {
        return Response.json({ token: "generated_installation_token" });
      }
      if (String(url).endsWith("/repos/acme/forge-generated") && method === "GET" && !created) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (String(url).endsWith("/orgs/acme/repos") && method === "POST") {
        created = true;
        return Response.json({ full_name: "acme/forge-generated" }, { status: 201 });
      }
      if (String(url).endsWith("/repos/acme/forge-generated/git/ref/heads/main")) {
        return Response.json({ object: { sha: "base_sha" } });
      }
      if (String(url).endsWith("/repos/acme/forge-generated/git/refs") && method === "POST") {
        return Response.json({ ref: "refs/heads/forge/test" }, { status: 201 });
      }
      if (String(url).includes("/repos/acme/forge-generated/contents/README.md") && method === "GET") {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (String(url).endsWith("/repos/acme/forge-generated/contents/README.md") && method === "PUT") {
        return Response.json({ content: { path: "README.md" } });
      }
      if (String(url).endsWith("/repos/acme/forge-generated/pulls") && method === "POST") {
        return Response.json({ html_url: "https://github.com/acme/forge-generated/pull/1" }, { status: 201 });
      }
      if (String(url).endsWith("/repos/acme/forge-generated") && method === "GET") {
        return Response.json({ default_branch: "main" });
      }
      return Response.json({ default_branch: "main" });
    }) as typeof fetch;

    const result = await createGitHubPrFromFiles({
      brief: generatedRepoBrief({
        github_connection_id: "gh_1",
        create_repo_if_missing: true
      }),
      githubConnection: githubConnection({ accountType: "Organization" }),
      files: [{ path: "README.md", content: "# Test\n" }]
    });

    assert.equal(result.generatedRepoUrl, "https://github.com/acme/forge-generated");
    assert.equal(result.prUrl, "https://github.com/acme/forge-generated/pull/1");
    assert.ok(
      requested.some((request) => request.url === "https://api.github.com/orgs/acme/repos" && request.method === "POST")
    );
    assert.equal(
      requested.some((request) => request.url === "https://api.github.com/user/repos" && request.method === "POST"),
      false
    );
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    globalThis.fetch = previousFetch;
  }
});

test("pre-created generated-repo PRs can use a GitHub App installation token", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousForgeToken = process.env.FORGE_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.FORGE_GITHUB_TOKEN = "env_token";
    globalThis.fetch = (async () => Response.json({ token: "generated_installation_token" })) as typeof fetch;

    const token = await resolveGitHubTokenForBuildTarget({
      brief: generatedRepoBrief({
        github_connection_id: "gh_1",
        create_repo_if_missing: false
      }),
      githubConnection: githubConnection()
    });

    assert.equal(token, "generated_installation_token");
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    restoreEnv("FORGE_GITHUB_TOKEN", previousForgeToken);
    globalThis.fetch = previousFetch;
  }
});

function existingRepoBrief(): BuildBrief {
  return {
    ...baseBrief(),
    build_target: {
      kind: "existing_repo_pr",
      target_repo_url: "https://github.com/acme/forge",
      github_connection_id: "gh_1",
      generated_repo_owner: "acme",
      generated_repo_name: "forge-generated",
      branch_name: "forge/test",
      pr_title: "Build MVP: Test",
      create_repo_if_missing: false
    }
  };
}

function generatedRepoBrief(
  overrides: Partial<BuildBrief["build_target"]> = {}
): BuildBrief {
  return {
    ...baseBrief(),
    build_target: {
      kind: "generated_repo_with_pr",
      target_repo_url: "https://github.com/acme/forge-generated",
      github_connection_id: null,
      generated_repo_owner: "acme",
      generated_repo_name: "forge-generated",
      branch_name: "forge/test",
      pr_title: "Build MVP: Test",
      create_repo_if_missing: true,
      ...overrides
    }
  };
}

function baseBrief(): BuildBrief {
  return {
    adapter: "gemini_managed",
    title: "Test",
    problem: "Problem",
    mvp_concept: "MVP",
    target_user: "User",
    user_notes: null,
    project: {
      id: "project_1",
      name: "Forge",
      mode: "connected_product",
      repo_url: "https://github.com/acme/forge"
    },
    build_target: {
      kind: "existing_repo_pr",
      target_repo_url: "https://github.com/acme/forge",
      github_connection_id: "gh_1",
      generated_repo_owner: "acme",
      generated_repo_name: "forge-generated",
      branch_name: "forge/test",
      pr_title: "Build MVP: Test",
      create_repo_if_missing: false
    },
    template_repo_url: "https://github.com/forge-labs/mvp-template",
    generated_pr_contract: {
      title_format: "Build MVP: Test",
      requires_runnable_app: true,
      requires_readme: true,
      requires_smoke_checks: true,
      no_paid_apis: true,
      no_production_deploy: true,
      document_free_external_services: true
    },
    evidence: [],
    evaluations: []
  };
}

function githubConnection(
  overrides: {
    id?: string;
    accountLogin?: string;
    accountType?: "User" | "Organization";
    provider?: DbGitHubConnection["provider"];
    installationId?: string | null;
    scopes?: string[];
  } = {}
): DbGitHubConnection {
  return {
    id: overrides.id ?? "gh_1",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    provider: overrides.provider ?? "github_app",
    account_login: overrides.accountLogin ?? "acme",
    account_type: overrides.accountType ?? "Organization",
    installation_id: overrides.installationId === undefined ? "999" : overrides.installationId,
    scopes: overrides.scopes ?? ["metadata", "contents:write", "issues:read", "administration:write"],
    status: "active"
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
