import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkGitHubConnectionHealth,
  checkGitHubAppConfiguration,
  exchangeGitHubUserCode,
  fetchGitHubInstallationAccount,
  githubCallbackState,
  githubInstallationStatusForWebhook,
  githubAppInstallUrl,
  githubPermissionScopes,
  githubUserAuthorizationUrl,
  installationAccessForConnection,
  isGitHubInstallationGoneError,
  isGitHubAppConfigured,
  isGitHubDevelopmentFallbackEnabled,
  parseGitHubCallbackState,
  verifyGitHubWebhookSignature
} from "./github/github-app.ts";
import type { DbGitHubConnection } from "./db/types.ts";

test("GitHub App install URL includes project state when configured", () => {
  const env = { GITHUB_APP_SLUG: "forge-test-app", GITHUB_STATE_SECRET: "state-secret" };
  const url = new URL(githubAppInstallUrl("project_1", env) ?? "");
  const state = url.searchParams.get("state");

  assert.equal(url.origin + url.pathname, "https://github.com/apps/forge-test-app/installations/new");
  assert.match(state ?? "", /^forge:v1:/);
  assert.deepEqual(parseGitHubCallbackState(state, env), {
    projectId: "project_1",
    verified: true,
    invalid: false
  });
});

test("GitHub App reports unconfigured without app id and private key", () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;

  try {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    assert.equal(isGitHubAppConfigured(), false);
  } finally {
    if (previousAppId !== undefined) process.env.GITHUB_APP_ID = previousAppId;
    if (previousKey !== undefined) process.env.GITHUB_APP_PRIVATE_KEY = previousKey;
  }
});

test("GitHub App configuration health exposes non-secret permission metadata", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      assert.equal(String(url), "https://api.github.com/app");
      return Response.json({
        id: 12345,
        slug: "forge-test",
        name: "Forge Test",
        owner: { login: "acme" },
        permissions: { contents: "write", issues: "read", administration: "write" }
      });
    }) as typeof fetch;

    const health = await checkGitHubAppConfiguration();

    assert.equal(health.slug, "forge-test");
    assert.deepEqual(health.permissions, { contents: "write", issues: "read", administration: "write" });
  } finally {
    restoreGithubEnv({
      GITHUB_APP_ID: previousAppId,
      GITHUB_APP_PRIVATE_KEY: previousKey
    });
    globalThis.fetch = previousFetch;
  }
});

test("GitHub App installation metadata exposes permission scopes for storage", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      assert.equal(String(url), "https://api.github.com/app/installations/999");
      return Response.json({
        account: { login: "acme", type: "Organization" },
        permissions: { contents: "write", issues: "read", administration: "write" }
      });
    }) as typeof fetch;

    const account = await fetchGitHubInstallationAccount("999");

    assert.equal(account.login, "acme");
    assert.equal(account.type, "Organization");
    assert.deepEqual(githubPermissionScopes(account.permissions), [
      "administration:write",
      "contents:write",
      "issues:read"
    ]);
  } finally {
    restoreGithubEnv({
      GITHUB_APP_ID: previousAppId,
      GITHUB_APP_PRIVATE_KEY: previousKey
    });
    globalThis.fetch = previousFetch;
  }
});

test("GitHub user OAuth URL includes project state when client id is configured", () => {
  const env = { GITHUB_APP_CLIENT_ID: "Iv1.client", GITHUB_STATE_SECRET: "state-secret" };
  const url = new URL(githubUserAuthorizationUrl("project_1", env) ?? "");
  const state = url.searchParams.get("state");

  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Iv1.client");
  assert.deepEqual(parseGitHubCallbackState(state, env), {
    projectId: "project_1",
    verified: true,
    invalid: false
  });
});

test("manual GitHub development fallback is explicit opt-in", () => {
  assert.equal(isGitHubDevelopmentFallbackEnabled({}), false);
  assert.equal(isGitHubDevelopmentFallbackEnabled({ FORGE_ENABLE_GITHUB_DEV_FALLBACK: "0" }), false);
  assert.equal(isGitHubDevelopmentFallbackEnabled({ FORGE_ENABLE_GITHUB_DEV_FALLBACK: "1" }), true);
  assert.equal(isGitHubDevelopmentFallbackEnabled({ FORGE_ENABLE_GITHUB_DEV_FALLBACK: "true" }), true);
});

test("GitHub callback state accepts legacy raw project ids when no state secret is configured", () => {
  const env = {};

  assert.equal(githubCallbackState("project_1", env), "project_1");
  assert.deepEqual(parseGitHubCallbackState("project_1", env), {
    projectId: "project_1",
    verified: false,
    invalid: false
  });
});

test("GitHub callback state rejects unsigned raw project ids when hosted auth is required", () => {
  const env = { FORGE_REQUIRE_AUTH: "1" };

  assert.equal(githubCallbackState("project_1", env), undefined);
  assert.equal(githubAppInstallUrl("project_1", { ...env, GITHUB_APP_SLUG: "forge-test-app" }), null);
  assert.equal(githubUserAuthorizationUrl("project_1", { ...env, GITHUB_APP_CLIENT_ID: "Iv1.client" }), null);
  assert.deepEqual(parseGitHubCallbackState("project_1", env), {
    projectId: null,
    verified: false,
    invalid: true,
    reason: "missing_secret"
  });
});

test("GitHub callback state rejects tampered signed state", () => {
  const env = { GITHUB_STATE_SECRET: "state-secret" };
  const state = githubCallbackState("project_1", env) ?? "";
  const parts = state.split(":");
  const tampered = `${parts.slice(0, -1).join(":")}:tampered`;

  assert.deepEqual(parseGitHubCallbackState(tampered, env), {
    projectId: null,
    verified: false,
    invalid: true,
    reason: "signature_mismatch"
  });
});

test("GitHub callback state rejects stale signed state", () => {
  const env = { GITHUB_STATE_SECRET: "state-secret", GITHUB_STATE_MAX_AGE_SECONDS: "900" };
  const staleIssuedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const state = signedGitHubState({
    secret: env.GITHUB_STATE_SECRET,
    payload: {
      projectId: "project_1",
      nonce: "nonce",
      issuedAt: staleIssuedAt
    }
  });

  assert.deepEqual(parseGitHubCallbackState(state, env), {
    projectId: null,
    verified: false,
    invalid: true,
    reason: "expired"
  });
});

test("GitHub user OAuth code exchange returns expiring token metadata", async () => {
  const env = captureGithubEnv();
  const previousFetch = globalThis.fetch;
  const requestedBodies: string[] = [];

  try {
    process.env.GITHUB_APP_CLIENT_ID = "Iv1.client";
    process.env.GITHUB_APP_CLIENT_SECRET = "client_secret";
    globalThis.fetch = (async (_url, init) => {
      requestedBodies.push(String(init?.body));
      return Response.json({
        access_token: "ghu_user_token",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_refresh",
        refresh_token_expires_in: 15897600,
        scope: ""
      });
    }) as typeof fetch;

    const access = await exchangeGitHubUserCode("oauth_code");

    assert.equal(access.token, "ghu_user_token");
    assert.equal(access.refreshToken, "ghr_refresh");
    assert.equal(access.scopes.length, 0);
    assert.match(requestedBodies[0], /client_id=Iv1\.client/);
    assert.match(requestedBodies[0], /code=oauth_code/);
  } finally {
    restoreGithubEnv(env);
    globalThis.fetch = previousFetch;
  }
});

test("GitHub App installation access keeps token metadata server-side", async () => {
  const env = captureGithubEnv();
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async () =>
      Response.json({
        token: "installation_token",
        expires_at: "2026-05-25T07:00:00Z",
        repository_selection: "selected",
        permissions: { contents: "read", issues: "read" }
      })) as typeof fetch;

    const access = await installationAccessForConnection(githubConnection());

    assert.equal(access?.token, "installation_token");
    assert.equal(access?.expiresAt, "2026-05-25T07:00:00Z");
    assert.deepEqual(access?.permissions, { contents: "read", issues: "read" });
    assert.equal(access?.repositorySelection, "selected");
  } finally {
    restoreGithubEnv(env);
    globalThis.fetch = previousFetch;
  }
});

test("GitHub App health check reports permissions and visible repository count", async () => {
  const env = captureGithubEnv();
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requested: string[] = [];

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      requested.push(String(url));
      if (String(url).includes("/access_tokens")) {
        return Response.json({
          token: "installation_token",
          expires_at: "2026-05-25T07:00:00Z",
          repository_selection: "selected",
          permissions: { contents: "read", issues: "read" }
        });
      }
      return Response.json({
        repositories: [
          {
            id: 1,
            full_name: "acme/forge",
            html_url: "https://github.com/acme/forge",
            private: true,
            default_branch: "main"
          }
        ]
      });
    }) as typeof fetch;

    const health = await checkGitHubConnectionHealth(githubConnection());

    assert.equal(health.accountLogin, "acme");
    assert.equal(health.repositoryCount, 1);
    assert.equal(health.repositorySelection, "selected");
    assert.deepEqual(health.permissions, { contents: "read", issues: "read" });
    assert.equal(requested.length, 2);
    assert.match(requested[1], /\/installation\/repositories/);
  } finally {
    restoreGithubEnv(env);
    globalThis.fetch = previousFetch;
  }
});

test("GitHub connection helpers keep OAuth token access server-side for generated repo account flows", () => {
  const githubApp = readFileSync(new URL("./github/github-app.ts", import.meta.url), "utf8");
  const repoDiscovery = readFileSync(new URL("./github/repo-discovery.ts", import.meta.url), "utf8");

  assert.match(githubApp, /export async function accessTokenForConnection/);
  assert.match(githubApp, /connection\?\.provider === "github_oauth"/);
  assert.match(githubApp, /listUserRepositoriesWithToken/);
  assert.match(githubApp, /\/user\/repos\?affiliation=owner,collaborator,organization_member/);
  assert.match(repoDiscovery, /installationTokenForConnection\(options\.connection\)/);
  assert.doesNotMatch(repoDiscovery, /accessTokenForConnection\(options\.connection\)/);
});

test("GitHub callback distinguishes App installs from user OAuth in settings feedback", () => {
  const callback = readFileSync(new URL("../app/(app)/github/callback/page.tsx", import.meta.url), "utf8");
  const settings = readFileSync(
    new URL("../app/(app)/projects/[projectId]/settings/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(callback, /github_provider", "app"/);
  assert.match(callback, /github_provider", "oauth"/);
  assert.match(settings, /github_provider === "oauth" \? "GitHub user authorized" : "GitHub App connected"/);
  assert.match(settings, /GitHub connection was not saved/);
});

test("GitHub callback keeps provider and token errors out of redirect messages", () => {
  const callback = readFileSync(new URL("../app/(app)/github/callback/page.tsx", import.meta.url), "utf8");

  assert.match(callback, /callbackSafeErrorMessage\(error, "GitHub App installation could not be saved\."\)/);
  assert.match(callback, /callbackSafeErrorMessage\(error, "GitHub user authorization could not be saved\."\)/);
  assert.doesNotMatch(callback, /error instanceof Error \? error\.message\.slice/);
});

test("GitHub App installation 404 is classified as a gone installation", async () => {
  const env = captureGithubEnv();
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "12345";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })) as typeof fetch;

    await assert.rejects(
      () => installationAccessForConnection(githubConnection()),
      (error) => isGitHubInstallationGoneError(error)
    );
  } finally {
    restoreGithubEnv(env);
    globalThis.fetch = previousFetch;
  }
});

test("GitHub webhook signature verification uses sha256 HMAC over the raw body", () => {
  const body = JSON.stringify({ action: "deleted", installation: { id: 999 } });
  const secret = "webhook-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyGitHubWebhookSignature({ body, secret, signatureHeader: signature }), true);
  assert.equal(verifyGitHubWebhookSignature({ body: `${body}\n`, secret, signatureHeader: signature }), false);
  assert.equal(verifyGitHubWebhookSignature({ body, secret, signatureHeader: "sha1=bad" }), false);
});

test("GitHub installation webhooks map lifecycle actions to connection statuses", () => {
  assert.deepEqual(
    githubInstallationStatusForWebhook("installation", {
      action: "deleted",
      installation: { id: 999 }
    }),
    { installationId: "999", status: "revoked" }
  );
  assert.deepEqual(
    githubInstallationStatusForWebhook("installation", {
      action: "suspend",
      installation: { id: "999" }
    }),
    { installationId: "999", status: "needs_reauth" }
  );
  assert.deepEqual(
    githubInstallationStatusForWebhook("installation", {
      action: "new_permissions_accepted",
      installation: { id: 999 }
    }),
    { installationId: "999", status: "active" }
  );
  assert.equal(
    githubInstallationStatusForWebhook("installation_repositories", {
      action: "added",
      installation: { id: 999 }
    }),
    null
  );
});

function githubConnection(): DbGitHubConnection {
  return {
    id: "gh_1",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    provider: "github_app",
    account_login: "acme",
    account_type: "Organization",
    installation_id: "999",
    scopes: ["metadata", "contents:read", "issues:read"],
    status: "active"
  };
}

function captureGithubEnv(): Record<string, string | undefined> {
  return {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_STATE_SECRET: process.env.GITHUB_STATE_SECRET,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    FORGE_ENABLE_GITHUB_DEV_FALLBACK: process.env.FORGE_ENABLE_GITHUB_DEV_FALLBACK
  };
}

function restoreGithubEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function signedGitHubState(input: { secret: string; payload: Record<string, unknown> }): string {
  const payload = base64Url(JSON.stringify(input.payload));
  const signature = createHmac("sha256", input.secret).update(payload).digest();
  return `forge:v1:${payload}:${base64Url(signature)}`;
}

function base64Url(value: string | Buffer): string {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
