import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRuntimeHandoff, formatRuntimeHandoff } from "./runtime/handoff.ts";
import { checkRuntimeHealth } from "./runtime/health.ts";
import { runtimeReadiness } from "./runtime/readiness.ts";
import { runtimeSetupReferences } from "./runtime/setup.ts";

test("runtime readiness reports missing live paths without exposing values", () => {
  const items = runtimeReadiness({});
  const github = items.find((item) => item.id === "github_app");
  const storage = items.find((item) => item.id === "storage");

  assert.equal(github?.status, "missing");
  assert.deepEqual(github?.missing, [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_SLUG",
    "GITHUB_WEBHOOK_SECRET",
    "FORGE_PUBLIC_APP_URL for GitHub callback and webhook proof"
  ]);
  assert.equal(storage?.status, "partial");
  assert.match(String(storage?.summary), /local JSON store/);
});

test("runtime readiness reports explicit local storage override even when Supabase env exists", async () => {
  const items = runtimeReadiness({
    FORGE_STORAGE_BACKEND: "local",
    SUPABASE_URL: "https://forge.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  });
  const storage = items.find((item) => item.id === "storage");

  assert.equal(storage?.status, "partial");
  assert.deepEqual(storage?.missing, []);
  assert.match(String(storage?.summary), /FORGE_STORAGE_BACKEND=local/);
  assert.match(String(storage?.detail), /Unset FORGE_STORAGE_BACKEND/);
});

test("runtime health skips hosted storage probe when local storage is forced", async () => {
  const result = await checkRuntimeHealth({
    env: {
      FORGE_STORAGE_BACKEND: "local",
      SUPABASE_URL: "https://forge.supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: (async () => {
      throw new Error("storage health should not fetch when local storage is forced");
    }) as typeof fetch
  });
  const storage = result.items.find((item) => item.id === "storage");

  assert.equal(storage?.status, "warning");
  assert.match(String(storage?.summary), /hosted Supabase storage was not checked/);
  assert.match(String(storage?.detail), /Unset FORGE_STORAGE_BACKEND/);
});

test("runtime handoff turns non-ready health into non-secret hosted setup actions", () => {
  const actions = buildRuntimeHandoff(
    {
      checkedAt: "2026-05-25T00:00:00.000Z",
      items: [
        {
          id: "storage",
          label: "Storage",
          status: "warning",
          summary: "FORGE_STORAGE_BACKEND=local is active; hosted Supabase storage was not checked."
        },
        {
          id: "github_app",
          label: "GitHub App",
          status: "skipped",
          summary: "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required before GitHub can be checked."
        },
        {
          id: "managed_research",
          label: "Managed research",
          status: "error",
          summary: "FORGE_MANAGED_RESEARCH_URL is missing; hosted brief research cannot run source-backed agents."
        },
        {
          id: "ai_intake",
          label: "AI intake",
          status: "ok",
          summary: "GEMINI_API_KEY is present."
        }
      ]
    },
    {
      FORGE_STORAGE_BACKEND: "local",
      SUPABASE_SERVICE_ROLE_KEY: "secret-service-role",
      GITHUB_APP_PRIVATE_KEY: "secret-private-key"
    }
  );
  const formatted = formatRuntimeHandoff(actions);

  assert.deepEqual(
    actions.map((action) => action.id),
    ["hosted_storage", "managed_research", "github_app"]
  );
  assert.match(formatted, /Unset FORGE_STORAGE_BACKEND/);
  assert.match(formatted, /pnpm supabase:preflight/);
  assert.match(formatted, /FORGE_MANAGED_RESEARCH_URL/);
  assert.match(formatted, /GITHUB_APP_ID/);
  assert.match(formatted, /FORGE_PUBLIC_APP_URL/);
  assert.doesNotMatch(formatted, /secret-service-role/);
  assert.doesNotMatch(formatted, /secret-private-key/);
});

test("runtime handoff is empty when every live path is ok", () => {
  const actions = buildRuntimeHandoff({
    checkedAt: "2026-05-25T00:00:00.000Z",
    items: [
      { id: "storage", label: "Storage", status: "ok", summary: "ready" },
      { id: "github_app", label: "GitHub App", status: "ok", summary: "ready" },
      { id: "managed_research", label: "Managed research", status: "ok", summary: "ready" },
      { id: "pipeline_worker", label: "Pipeline worker", status: "ok", summary: "ready" },
      { id: "user_session", label: "Email account", status: "ok", summary: "ready" },
      { id: "managed_builder", label: "Managed builder", status: "ok", summary: "ready" }
    ]
  });

  assert.deepEqual(actions, []);
  assert.equal(formatRuntimeHandoff(actions), "Hosted runtime handoff: no follow-up actions detected.");
});

test("runtime handoff gives schema-specific Supabase migration guidance", () => {
  const actions = buildRuntimeHandoff({
    checkedAt: "2026-05-25T00:00:00.000Z",
    items: [
      {
        id: "storage",
        label: "Storage",
        status: "error",
        summary: "Supabase storage schema is incomplete.",
        detail: "Missing table or column detected. SUPABASE_DB_URL is not configured."
      }
    ]
  });
  const storage = actions.find((action) => action.id === "hosted_storage");

  assert.match(String(storage?.detail), /Set a local-only SUPABASE_DB_URL/);
  assert.doesNotMatch(String(storage?.detail), /Configure SUPABASE_URL/);
});

test("runtime setup references derive exact provider URLs from the public app URL", () => {
  const env = { FORGE_PUBLIC_APP_URL: "https://forge.example.test/" };
  const userSession = runtimeSetupReferences("user_session", env);
  const githubApp = runtimeSetupReferences("github_app", env);
  const worker = runtimeSetupReferences("pipeline_worker", env);

  assert.deepEqual(
    userSession.map((setup) => [setup.label, setup.value, setup.proof?.kind]),
    [
      ["Supabase Auth redirect URL", "https://forge.example.test/auth/callback", "runtime_health"],
      ["Forge email signup URL", "https://forge.example.test/signup", "callback_flow"]
    ]
  );
  assert.deepEqual(
    githubApp.map((setup) => [setup.label, setup.value, setup.proof?.kind]),
    [
      ["GitHub setup/OAuth callback URL", "https://forge.example.test/github/callback", "callback_flow"],
      ["GitHub webhook URL", "https://forge.example.test/api/github/webhook", "runtime_health"]
    ]
  );
  assert.deepEqual(
    worker.map((setup) => [setup.label, setup.value, setup.proof?.kind]),
    [["Worker endpoint URL", "https://forge.example.test/api/pipeline/worker", "runtime_health"]]
  );
});

test("runtime handoff includes non-secret provider setup URLs when available", () => {
  const actions = buildRuntimeHandoff(
    {
      checkedAt: "2026-05-25T00:00:00.000Z",
      items: [
        { id: "user_session", label: "Email account", status: "warning", summary: "missing auth" },
        { id: "github_app", label: "GitHub App", status: "warning", summary: "missing webhook proof" },
        { id: "pipeline_worker", label: "Pipeline worker", status: "warning", summary: "missing worker proof" }
      ]
    },
    {
      FORGE_PUBLIC_APP_URL: "https://forge.example.test",
      SUPABASE_ANON_KEY: "anon-secret",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      FORGE_PIPELINE_WORKER_SECRET: "worker-secret"
    }
  );
  const formatted = formatRuntimeHandoff(actions);

  assert.match(formatted, /Supabase Auth redirect URL: https:\/\/forge\.example\.test\/auth\/callback/);
  assert.match(formatted, /GitHub setup\/OAuth callback URL: https:\/\/forge\.example\.test\/github\/callback/);
  assert.match(formatted, /GitHub webhook URL: https:\/\/forge\.example\.test\/api\/github\/webhook/);
  assert.match(formatted, /Worker endpoint URL: https:\/\/forge\.example\.test\/api\/pipeline\/worker/);
  assert.match(formatted, /Not proved until a valid signed-in session reaches Forge/);
  assert.match(formatted, /Not proved by webhook ping; complete the GitHub callback flow/);
  assert.match(formatted, /Not proved until the signed webhook ping is accepted/);
  assert.doesNotMatch(formatted, /anon-secret|webhook-secret|worker-secret/);
});

test("runtime readiness reports queued pipeline worker requirements", () => {
  const missingWorker = runtimeReadiness({}).find((item) => item.id === "pipeline_worker");
  assert.equal(missingWorker?.status, "missing");
  assert.deepEqual(missingWorker?.missing, [
    "FORGE_PIPELINE_WORKER_SECRET or CRON_SECRET",
    "FORGE_PUBLIC_APP_URL for worker route proof"
  ]);

  const partialWorker = runtimeReadiness({ CRON_SECRET: "cron-secret" }).find((item) => item.id === "pipeline_worker");
  assert.equal(partialWorker?.status, "partial");
  assert.deepEqual(partialWorker?.missing, ["FORGE_PUBLIC_APP_URL for worker route proof"]);

  const readyWorker = runtimeReadiness({
    CRON_SECRET: "cron-secret",
    FORGE_PUBLIC_APP_URL: "https://forge.example.test"
  }).find((item) => item.id === "pipeline_worker");
  assert.equal(readyWorker?.status, "ready");
  assert.deepEqual(readyWorker?.missing, []);
});

test("runtime readiness items include setup references for hosted provider consoles", () => {
  const items = runtimeReadiness({
    FORGE_PUBLIC_APP_URL: "https://forge.example.test",
    SUPABASE_URL: "https://forge.supabase.test",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  });
  const userSession = items.find((item) => item.id === "user_session");

  assert.deepEqual(
    userSession?.setup.map((setup) => [setup.label, setup.value, setup.proof?.kind]),
    [
      ["Supabase Auth redirect URL", "https://forge.example.test/auth/callback", "runtime_health"],
      ["Forge email signup URL", "https://forge.example.test/signup", "callback_flow"]
    ]
  );
});

test("runtime readiness panel labels setup URLs as configured versus live-proved", () => {
  const source = readRuntimePanelSource();

  assert.match(source, /setupProofStatus\(setup, healthItem\)/);
  assert.match(source, /setup\.proof\.kind === "callback_flow"/);
  assert.match(source, /healthItem\.status === "ok" \? "proved" : "not-proved"/);
  assert.match(source, /setup\.proof\.uncheckedLabel/);
  assert.match(source, /setup\.proof\.provedLabel/);
  assert.match(source, /setup\.proof\.notProvedLabel/);
});

test("runtime health probes the secured pipeline worker endpoint without processing work", async () => {
  const requests: Array<{ url: string; authorization: string | null; body: string | null }> = [];
  const result = await checkRuntimeHealth({
    env: {
      FORGE_PUBLIC_APP_URL: "https://forge.example.test",
      FORGE_PIPELINE_WORKER_SECRET: "worker-secret"
    },
    fetchImpl: (async (url, init) => {
      requests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : null
      });
      return Response.json({ status: "ok", mode: "probe" });
    }) as typeof fetch
  });
  const worker = result.items.find((item) => item.id === "pipeline_worker");

  assert.equal(worker?.status, "ok");
  assert.match(String(worker?.summary), /accepted the bearer probe/);
  assert.deepEqual(requests, [
    {
      url: "https://forge.example.test/api/pipeline/worker",
      authorization: "Bearer worker-secret",
      body: JSON.stringify({ probe: true })
    }
  ]);
});

test("runtime health warns when worker secret exists without a public app URL", async () => {
  const result = await checkRuntimeHealth({
    env: {
      CRON_SECRET: "cron-secret"
    },
    fetchImpl: (async () => {
      throw new Error("worker probe should not fetch without FORGE_PUBLIC_APP_URL");
    }) as typeof fetch
  });
  const worker = result.items.find((item) => item.id === "pipeline_worker");

  assert.equal(worker?.status, "warning");
  assert.match(String(worker?.summary), /FORGE_PUBLIC_APP_URL is missing/);
});

test("runtime health redacts worker endpoint response bodies", async () => {
  const result = await checkRuntimeHealth({
    env: {
      FORGE_PUBLIC_APP_URL: "https://forge.example.test",
      FORGE_PIPELINE_WORKER_SECRET: "worker-secret"
    },
    fetchImpl: (async () =>
      new Response(
        "Authorization: Bearer worker-secret access_token=leaked-token secret=other-secret",
        { status: 500 }
      )) as typeof fetch
  });
  const worker = result.items.find((item) => item.id === "pipeline_worker");

  assert.equal(worker?.status, "error");
  assert.match(String(worker?.detail), /Authorization: Bearer \[REDACTED\]/);
  assert.doesNotMatch(String(worker?.detail), /worker-secret/);
  assert.doesNotMatch(String(worker?.detail), /leaked-token/);
  assert.doesNotMatch(String(worker?.detail), /other-secret/);
});

test("runtime readiness marks GitHub App partial when webhook secret is missing", () => {
  const github = runtimeReadiness({
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: "secret-private-key",
    GITHUB_APP_SLUG: "forge-test",
    FORGE_PUBLIC_APP_URL: "https://forge.example.test"
  }).find((item) => item.id === "github_app");

  assert.equal(github?.status, "partial");
  assert.deepEqual(github?.missing, ["GITHUB_WEBHOOK_SECRET"]);
});

test("runtime health reports incomplete GitHub App permissions", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      if (String(url) === "https://api.github.com/app") {
        return Response.json({
          slug: "forge-test",
          permissions: { contents: "read", issues: "read" }
        });
      }
      return Response.json({ ok: true, ignored: true }, { status: 202 });
    }) as typeof fetch;
    const result = await checkRuntimeHealth({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
        GITHUB_APP_SLUG: "forge-test",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        FORGE_PUBLIC_APP_URL: "https://forge.example.test"
      }
    });
    const github = result.items.find((item) => item.id === "github_app");

    assert.equal(github?.status, "warning");
    assert.match(String(github?.summary), /permissions are incomplete/);
    assert.match(String(github?.detail), /Contents write permission/);
    assert.match(String(github?.detail), /Administration write permission/);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health accepts GitHub App permissions needed for repo and generated build paths", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const webhookRequests: Array<{
    url: string;
    event: string | null;
    signature: string | null;
    body: string | null;
  }> = [];

  try {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url, init) => {
      if (String(url) === "https://api.github.com/app") {
        return Response.json({
          slug: "forge-test",
          permissions: { contents: "write", issues: "read", administration: "write" }
        });
      }
      webhookRequests.push({
        url: String(url),
        event: new Headers(init?.headers).get("x-github-event"),
        signature: new Headers(init?.headers).get("x-hub-signature-256"),
        body: typeof init?.body === "string" ? init.body : null
      });
      return Response.json({ ok: true, ignored: true }, { status: 202 });
    }) as typeof fetch;
    const result = await checkRuntimeHealth({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
        GITHUB_APP_SLUG: "forge-test",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        FORGE_PUBLIC_APP_URL: "https://forge.example.test"
      }
    });
    const github = result.items.find((item) => item.id === "github_app");

    assert.equal(github?.status, "ok");
    assert.match(String(github?.summary), /Signed webhook ping was accepted/);
    assert.deepEqual(webhookRequests.map((request) => request.url), [
      "https://forge.example.test/api/github/webhook"
    ]);
    assert.equal(webhookRequests[0]?.event, "ping");
    assert.equal(
      webhookRequests[0]?.signature,
      `sha256=${createHmac("sha256", "webhook-secret").update(String(webhookRequests[0]?.body)).digest("hex")}`
    );
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health validates GitHub App credentials from injected env", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    globalThis.fetch = (async (url) => {
      if (String(url) === "https://api.github.com/app") {
        return Response.json({
          slug: "forge-test",
          permissions: { contents: "write", issues: "read", administration: "write" }
        });
      }
      return Response.json({ ok: true, ignored: true }, { status: 202 });
    }) as typeof fetch;
    const result = await checkRuntimeHealth({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
        GITHUB_APP_SLUG: "forge-test",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        FORGE_PUBLIC_APP_URL: "https://forge.example.test"
      }
    });
    const github = result.items.find((item) => item.id === "github_app");

    assert.equal(github?.status, "ok");
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health warns when GitHub webhook secret exists without a public app URL", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      if (String(url) === "https://api.github.com/app") {
        return Response.json({
          slug: "forge-test",
          permissions: { contents: "write", issues: "read", administration: "write" }
        });
      }
      throw new Error("webhook ping should not fetch without FORGE_PUBLIC_APP_URL");
    }) as typeof fetch;
    const result = await checkRuntimeHealth({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
        GITHUB_APP_SLUG: "forge-test",
        GITHUB_WEBHOOK_SECRET: "webhook-secret"
      }
    });
    const github = result.items.find((item) => item.id === "github_app");

    assert.equal(github?.status, "warning");
    assert.match(String(github?.summary), /missing FORGE_PUBLIC_APP_URL/);
    assert.equal(github?.detail, undefined);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health warns when signed GitHub webhook ping is rejected", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      if (String(url) === "https://api.github.com/app") {
        return Response.json({
          slug: "forge-test",
          permissions: { contents: "write", issues: "read", administration: "write" }
        });
      }
      return Response.json({ ok: false, message: "bad signature", secret: "webhook-secret" }, { status: 401 });
    }) as typeof fetch;
    const result = await checkRuntimeHealth({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
        GITHUB_APP_SLUG: "forge-test",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        FORGE_PUBLIC_APP_URL: "https://forge.example.test"
      }
    });
    const github = result.items.find((item) => item.id === "github_app");

    assert.equal(github?.status, "warning");
    assert.match(String(github?.detail), /returned 401/);
    assert.doesNotMatch(String(github?.detail), /webhook-secret/);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health warns when only the GitHub webhook secret is missing", async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  try {
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    globalThis.fetch = (async (url) => {
      if (String(url) === "https://api.github.com/app") {
        return Response.json({
          slug: "forge-test",
          permissions: { contents: "write", issues: "read", administration: "write" }
        });
      }
      return Response.json({});
    }) as typeof fetch;
    const result = await checkRuntimeHealth({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
        GITHUB_APP_SLUG: "forge-test"
      }
    });
    const github = result.items.find((item) => item.id === "github_app");

    assert.equal(github?.status, "warning");
    assert.match(String(github?.summary), /missing GITHUB_WEBHOOK_SECRET/);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime readiness requires managed research bearer secret by default", () => {
  const managedResearch = runtimeReadiness({
    FORGE_MANAGED_RESEARCH_URL: "http://research.local"
  }).find((item) => item.id === "managed_research");

  assert.equal(managedResearch?.status, "missing");
  assert.deepEqual(managedResearch?.missing, ["FORGE_MANAGED_RESEARCH_SECRET"]);
});

test("runtime readiness allows explicit unauthenticated managed research mode", () => {
  const managedResearch = runtimeReadiness({
    FORGE_MANAGED_RESEARCH_URL: "http://research.local",
    FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH: "1"
  }).find((item) => item.id === "managed_research");

  assert.equal(managedResearch?.status, "ready");
  assert.deepEqual(managedResearch?.missing, []);
  assert.match(String(managedResearch?.detail), /Unauthenticated API mode/);
});

test("runtime readiness treats unauthenticated managed research as local-dev only", () => {
  const managedResearch = runtimeReadiness({
    FORGE_REQUIRE_AUTH: "1",
    FORGE_MANAGED_RESEARCH_URL: "http://research.local",
    FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH: "1"
  }).find((item) => item.id === "managed_research");

  assert.equal(managedResearch?.status, "missing");
  assert.deepEqual(managedResearch?.missing, ["FORGE_MANAGED_RESEARCH_SECRET"]);
  assert.match(String(managedResearch?.summary), /Hosted approved-brief research is blocked/);
});

test("runtime readiness reports hosted user session requirements", () => {
  const missingSession = runtimeReadiness({
    SUPABASE_URL: "https://forge.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    FORGE_AUTH_SUBJECT: "dev-auth-subject"
  }).find((item) => item.id === "user_session");

  assert.equal(missingSession?.status, "partial");
  assert.deepEqual(missingSession?.missing, [
    "SUPABASE_URL and SUPABASE_ANON_KEY for request-session auth",
    "FORGE_PUBLIC_APP_URL for sign-in callback setup proof"
  ]);

  const readySession = runtimeReadiness({
    SUPABASE_URL: "https://forge.supabase.test",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    FORGE_PUBLIC_APP_URL: "https://forge.example.test"
  }).find((item) => item.id === "user_session");

  assert.equal(readySession?.status, "ready");
  assert.deepEqual(readySession?.missing, []);
});

test("runtime readiness treats required auth as missing until hosted session config exists", () => {
  const userSession = runtimeReadiness({
    FORGE_REQUIRE_AUTH: "1",
    FORGE_USER_ID: "local-user",
    FORGE_WORKSPACE_ID: "local-workspace"
  }).find((item) => item.id === "user_session");

  assert.equal(userSession?.status, "missing");
  assert.match(String(userSession?.summary), /Hosted email auth is required/);
});

test("runtime readiness marks managed research ready with url and bearer secret", () => {
  const managedResearch = runtimeReadiness({
    FORGE_MANAGED_RESEARCH_URL: "http://research.local",
    FORGE_MANAGED_RESEARCH_SECRET: "research-secret"
  }).find((item) => item.id === "managed_research");

  assert.equal(managedResearch?.status, "ready");
  assert.deepEqual(managedResearch?.missing, []);
});

test("runtime readiness treats explicit GitHub token fallback as local-dev only", () => {
  const builder = runtimeReadiness({
    GEMINI_API_KEY: "secret",
    GITHUB_TOKEN: "secret",
    FORGE_ALLOW_GITHUB_TOKEN_FALLBACK: "1",
    FORGE_GENERATED_REPO_OWNER: "acme",
    FORGE_TEMPLATE_REPO_URL: "https://github.com/acme/template"
  }).find((item) => item.id === "managed_builder");

  assert.equal(builder?.status, "partial");
  assert.match(String(builder?.summary), /Local dev token fallback/);
  assert.deepEqual(builder?.missing, ["GitHub OAuth for user-account generated repo creation"]);
});

test("runtime readiness ignores GitHub token fallback when hosted auth is required", () => {
  const builder = runtimeReadiness({
    GEMINI_API_KEY: "secret",
    GITHUB_TOKEN: "secret",
    FORGE_ALLOW_GITHUB_TOKEN_FALLBACK: "1",
    FORGE_REQUIRE_AUTH: "1",
    FORGE_GENERATED_REPO_OWNER: "acme",
    FORGE_TEMPLATE_REPO_URL: "https://github.com/acme/template"
  }).find((item) => item.id === "managed_builder");

  assert.equal(builder?.status, "partial");
  assert.doesNotMatch(String(builder?.summary), /Local dev token fallback/);
  assert.deepEqual(builder?.missing, ["GitHub OAuth for user-account generated repo creation"]);
});

test("runtime readiness does not count server GitHub tokens unless fallback is explicit", () => {
  const builder = runtimeReadiness({
    GEMINI_API_KEY: "secret",
    GITHUB_TOKEN: "secret",
    FORGE_GENERATED_REPO_OWNER: "acme",
    FORGE_TEMPLATE_REPO_URL: "https://github.com/acme/template"
  }).find((item) => item.id === "managed_builder");

  assert.equal(builder?.status, "partial");
  assert.deepEqual(builder?.missing, [
    "GitHub OAuth for user-account generated repo creation"
  ]);
});

test("runtime readiness accepts GitHub OAuth for user-account generated repo creation", () => {
  const builder = runtimeReadiness({
    GEMINI_API_KEY: "secret",
    GITHUB_APP_CLIENT_ID: "client",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_STATE_SECRET: "state-secret",
    FORGE_GENERATED_REPO_OWNER: "acme",
    FORGE_TEMPLATE_REPO_URL: "https://github.com/acme/template",
    FORGE_PUBLIC_APP_URL: "https://forge.example.test"
  }).find((item) => item.id === "managed_builder");

  assert.equal(builder?.status, "ready");
  assert.deepEqual(builder?.missing, []);
  assert.doesNotMatch(String(builder?.detail), /fallback/);
});

test("runtime readiness requires token encryption for hosted GitHub OAuth storage", () => {
  const builder = runtimeReadiness({
    GEMINI_API_KEY: "secret",
    GITHUB_APP_CLIENT_ID: "client",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_STATE_SECRET: "state-secret",
    FORGE_GENERATED_REPO_OWNER: "acme",
    FORGE_TEMPLATE_REPO_URL: "https://github.com/acme/template",
    FORGE_PUBLIC_APP_URL: "https://forge.example.test",
    SUPABASE_URL: "https://forge.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  }).find((item) => item.id === "managed_builder");

  assert.equal(builder?.status, "partial");
  assert.deepEqual(builder?.missing, ["FORGE_TOKEN_ENCRYPTION_KEY for hosted GitHub OAuth token storage"]);
});

test("runtime readiness requires signed state for GitHub OAuth callbacks", () => {
  const builder = runtimeReadiness({
    GEMINI_API_KEY: "secret",
    GITHUB_APP_CLIENT_ID: "client",
    GITHUB_APP_CLIENT_SECRET: "secret",
    FORGE_GENERATED_REPO_OWNER: "acme",
    FORGE_TEMPLATE_REPO_URL: "https://github.com/acme/template",
    FORGE_PUBLIC_APP_URL: "https://forge.example.test"
  }).find((item) => item.id === "managed_builder");

  assert.equal(builder?.status, "partial");
  assert.deepEqual(builder?.missing, ["GITHUB_STATE_SECRET or GITHUB_WEBHOOK_SECRET for GitHub OAuth callback state"]);
});


test("runtime health checks managed research /health when configured", async () => {
  const requested: string[] = [];
  const result = await checkRuntimeHealth({
    env: { FORGE_MANAGED_RESEARCH_URL: "http://research.local" },
    fetchImpl: (async (url) => {
      requested.push(String(url));
      return Response.json({ status: "ok" });
    }) as typeof fetch
  });
  const managedResearch = result.items.find((item) => item.id === "managed_research");

  assert.deepEqual(requested, ["http://research.local/health"]);
  assert.equal(managedResearch?.status, "ok");
  assert.match(String(managedResearch?.detail), /status=ok/);
});

test("runtime health redacts managed research health response bodies", async () => {
  const result = await checkRuntimeHealth({
    env: {
      FORGE_MANAGED_RESEARCH_URL: "http://research.local",
      FORGE_MANAGED_RESEARCH_SECRET: "research-secret"
    },
    fetchImpl: (async () =>
      new Response(
        "Authorization: Bearer research-secret github_access_token=github-token api_key=gemini-key",
        { status: 503 }
      )) as typeof fetch
  });
  const managedResearch = result.items.find((item) => item.id === "managed_research");

  assert.equal(managedResearch?.status, "error");
  assert.doesNotMatch(String(managedResearch?.detail), /research-secret/);
  assert.doesNotMatch(String(managedResearch?.detail), /github-token/);
  assert.doesNotMatch(String(managedResearch?.detail), /gemini-key/);
  assert.match(String(managedResearch?.detail), /Authorization: Bearer \[REDACTED\]/);
});

test("runtime health skips managed research network checks when unconfigured", async () => {
  let fetchCalled = false;
  const result = await checkRuntimeHealth({
    env: {},
    fetchImpl: (async () => {
      fetchCalled = true;
      return Response.json({ status: "ok" });
    }) as typeof fetch
  });
  const managedResearch = result.items.find((item) => item.id === "managed_research");

  assert.equal(fetchCalled, false);
  assert.equal(managedResearch?.status, "skipped");
  assert.match(String(managedResearch?.summary), /FORGE_MANAGED_RESEARCH_URL/);
});

test("runtime health reports missing managed research as a hosted error", async () => {
  let fetchCalled = false;
  const result = await checkRuntimeHealth({
    env: { FORGE_REQUIRE_AUTH: "1" },
    fetchImpl: (async () => {
      fetchCalled = true;
      return Response.json({ status: "ok" });
    }) as typeof fetch
  });
  const managedResearch = result.items.find((item) => item.id === "managed_research");

  assert.equal(fetchCalled, false);
  assert.equal(managedResearch?.status, "error");
  assert.match(String(managedResearch?.summary), /hosted brief research cannot run/);
});

test("runtime health requires managed research bearer secret in hosted mode", async () => {
  let fetchCalled = false;
  const result = await checkRuntimeHealth({
    env: {
      FORGE_REQUIRE_AUTH: "1",
      FORGE_MANAGED_RESEARCH_URL: "http://research.local",
      FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH: "1"
    },
    fetchImpl: (async () => {
      fetchCalled = true;
      return Response.json({ status: "ok" });
    }) as typeof fetch
  });
  const managedResearch = result.items.find((item) => item.id === "managed_research");

  assert.equal(fetchCalled, false);
  assert.equal(managedResearch?.status, "error");
  assert.match(String(managedResearch?.summary), /FORGE_MANAGED_RESEARCH_SECRET is missing/);
});

test("runtime health reports configured user-session auth without requiring a token in the check", async () => {
  const result = await checkRuntimeHealth({
    env: {
      SUPABASE_URL: "https://forge.supabase.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    }
  });
  const userSession = result.items.find((item) => item.id === "user_session");

  assert.equal(userSession?.status, "warning");
  assert.match(String(userSession?.summary), /did not include a valid Supabase Auth session/);
});

test("runtime health can validate an explicit Supabase auth bearer for CLI smoke", async () => {
  const requested: Array<{ url: string; authorization: string | null }> = [];
  const result = await checkRuntimeHealth({
    env: {
      SUPABASE_URL: "https://forge.supabase.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    authBearerToken: "user-access-token",
    fetchImpl: (async (url, init) => {
      requested.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization")
      });
      if (String(url).includes("/auth/v1/user")) {
        return Response.json({ id: "auth-user-1", email: "founder@example.com" });
      }
      return Response.json([]);
    }) as typeof fetch
  });
  const userSession = result.items.find((item) => item.id === "user_session");

  assert.equal(userSession?.status, "ok");
  assert.match(String(userSession?.summary), /session validated/);
  assert.ok(
    requested.some((request) =>
      request.url === "https://forge.supabase.test/auth/v1/user" &&
      request.authorization === "Bearer user-access-token"
    ),
    "expected runtime smoke to validate the supplied auth bearer"
  );
});

test("runtime health verifies hosted Supabase tables and columns added by Forge plumbing", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousDbUrl = process.env.SUPABASE_DB_URL;
  const previousFetch = globalThis.fetch;
  const requestedTables: string[] = [];
  const requestedQueries: string[] = [];

  try {
    process.env.SUPABASE_URL = "https://forge.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    globalThis.fetch = (async (url) => {
      const match = String(url).match(/\/rest\/v1\/([^?]+)/);
      if (match) requestedTables.push(match[1]);
      requestedQueries.push(String(url));
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkRuntimeHealth({
      env: {
        SUPABASE_URL: "https://forge.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role"
      }
    });
    const storage = result.items.find((item) => item.id === "storage");

    assert.equal(storage?.status, "ok");
    for (const table of ["github_user_tokens", "research_briefs", "agent_tasks", "workspaces"]) {
      assert.ok(requestedTables.includes(table), `expected storage health to check ${table}`);
    }
    assert.ok(
      requestedQueries.some((url) => url.includes("/projects?select=id,owner_user_id,workspace_id,mode,repo_url")),
      "expected storage health to verify project ownership columns"
    );
    assert.ok(
      requestedQueries.some((url) =>
        url.includes("/github_user_tokens?select=id,connection_id,owner_user_id,token_type,expires_at,refresh_token_expires_at")
      ),
      "expected storage health to verify GitHub OAuth token metadata columns"
    );
    assert.equal(
      requestedQueries.some((url) => /github_user_tokens\?select=.*(?:access_token|refresh_token)(?:[,&]|$)/.test(url)),
      false,
      "storage health must not fetch secret token columns"
    );
    assert.ok(
      requestedQueries.some((url) => url.includes("/agent_tasks?select=id,project_id,pipeline_run_id,research_brief_id,agent_role,status")),
      "expected storage health to verify agent task research columns"
    );
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health reports missing hosted Supabase columns as migration errors", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;

  try {
    process.env.SUPABASE_URL = "https://forge.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    globalThis.fetch = (async (url) => {
      if (String(url).includes("/github_user_tokens?")) {
        return new Response(JSON.stringify({ message: "column refresh_token_expires_at does not exist" }), { status: 400 });
      }
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkRuntimeHealth({
      env: {
        SUPABASE_URL: "https://forge.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role"
      }
    });
    const storage = result.items.find((item) => item.id === "storage");

    assert.equal(storage?.status, "error");
    assert.match(String(storage?.summary), /schema is incomplete/);
    assert.match(String(storage?.detail), /pnpm supabase:migrate/);
    assert.match(String(storage?.detail), /SUPABASE_DB_URL is not configured/);
    assert.match(String(storage?.detail), /github_user_tokens/);
    assert.match(String(storage?.detail), /refresh_token_expires_at/);
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousKey);
    globalThis.fetch = previousFetch;
  }
});

test("runtime health reports missing hosted Supabase tables as migration errors", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousDbUrl = process.env.SUPABASE_DB_URL;
  const previousFetch = globalThis.fetch;

  try {
    process.env.SUPABASE_URL = "https://forge.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SUPABASE_DB_URL = "postgres://forge.test/postgres";
    globalThis.fetch = (async (url) => {
      if (String(url).includes("/users?")) {
        return new Response(
          JSON.stringify({
            code: "PGRST205",
            message: "Could not find the table 'public.users' in the schema cache"
          }),
          { status: 404 }
        );
      }
      return Response.json([]);
    }) as typeof fetch;

    const result = await checkRuntimeHealth({
      env: {
        SUPABASE_URL: "https://forge.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_DB_URL: "postgres://forge.test/postgres"
      }
    });
    const storage = result.items.find((item) => item.id === "storage");

    assert.equal(storage?.status, "error");
    assert.match(String(storage?.summary), /schema is incomplete/);
    assert.match(String(storage?.detail), /public\.users/);
    assert.match(String(storage?.detail), /SUPABASE_DB_URL is configured/);
    assert.match(String(storage?.detail), /pnpm supabase:migrate/);
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousKey);
    restoreEnv("SUPABASE_DB_URL", previousDbUrl);
    globalThis.fetch = previousFetch;
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function readRuntimePanelSource(): string {
  return readFileSync(new URL("../components/settings/RuntimeReadinessPanel.tsx", import.meta.url), "utf8");
}
