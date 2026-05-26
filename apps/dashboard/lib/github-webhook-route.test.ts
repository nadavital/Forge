import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve(new URL("../node_modules/next/server.js", import.meta.url).href, context);
    }
    if (specifier.startsWith("@/")) {
      const localPath = specifier.endsWith(".ts") ? specifier.slice(2) : `${specifier.slice(2)}.ts`;
      return nextResolve(new URL(`../${localPath}`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

test("GitHub webhook route verifies signatures before mutating installation connections", async () => {
  const storeDir = await mkdtemp(path.join(tmpdir(), "forge-github-webhook-route-"));
  const previousEnv = captureEnv();

  try {
    process.env.FORGE_LOCAL_STORE_DIR = storeDir;
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    process.env.SUPABASE_ANON_KEY = "";
    process.env.FORGE_USER_ID = "webhook_user";
    process.env.FORGE_WORKSPACE_ID = "webhook_workspace";
    process.env.FORGE_AUTH_SUBJECT = "webhook_auth_subject";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const [{ upsertGitHubConnection, loadStore }, route] = await Promise.all([
      import("./db/repository.ts"),
      import("../app/api/github/webhook/route.ts")
    ]);

    const connection = await upsertGitHubConnection({
      accountLogin: "acme",
      accountType: "Organization",
      installationId: "999",
      provider: "github_app",
      scopes: ["contents:write"]
    });

    const body = JSON.stringify({ action: "deleted", installation: { id: 999 } });
    const invalid = await route.POST(webhookRequest({ body, signature: "sha256=bad" }));
    assert.equal(invalid.status, 401);
    assert.equal((await loadStore()).github_connections.find((row) => row.id === connection.id)?.status, "active");

    const valid = await route.POST(webhookRequest({ body, signature: signatureFor(body) }));
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), {
      ok: true,
      installationId: "999",
      status: "revoked",
      updatedConnections: 1
    });
    assert.equal((await loadStore()).github_connections.find((row) => row.id === connection.id)?.status, "revoked");
  } finally {
    restoreEnv(previousEnv);
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("GitHub webhook route ignores unsupported events after signature verification", async () => {
  const storeDir = await mkdtemp(path.join(tmpdir(), "forge-github-webhook-ignore-"));
  const previousEnv = captureEnv();

  try {
    process.env.FORGE_LOCAL_STORE_DIR = storeDir;
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    process.env.SUPABASE_ANON_KEY = "";
    process.env.FORGE_USER_ID = "webhook_user";
    process.env.FORGE_WORKSPACE_ID = "webhook_workspace";
    process.env.FORGE_AUTH_SUBJECT = "webhook_auth_subject";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const route = await import("../app/api/github/webhook/route.ts");
    const body = JSON.stringify({ action: "added", installation: { id: 999 } });
    const response = await route.POST(
      webhookRequest({
        body,
        event: "installation_repositories",
        signature: signatureFor(body)
      })
    );

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, ignored: true });
  } finally {
    restoreEnv(previousEnv);
    await rm(storeDir, { recursive: true, force: true });
  }
});

function webhookRequest(input: { body: string; signature: string; event?: string }): Request {
  return new Request("http://127.0.0.1/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": input.event ?? "installation",
      "x-hub-signature-256": input.signature
    },
    body: input.body
  });
}

function signatureFor(body: string): string {
  return `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
}

function captureEnv(): Record<string, string | undefined> {
  return {
    FORGE_LOCAL_STORE_DIR: process.env.FORGE_LOCAL_STORE_DIR,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    FORGE_USER_ID: process.env.FORGE_USER_ID,
    FORGE_WORKSPACE_ID: process.env.FORGE_WORKSPACE_ID,
    FORGE_AUTH_SUBJECT: process.env.FORGE_AUTH_SUBJECT,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET
  };
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
