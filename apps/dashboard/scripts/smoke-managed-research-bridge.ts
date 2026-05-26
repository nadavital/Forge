#!/usr/bin/env node

import { createServer } from "node:http";
import { registerHooks } from "node:module";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const localPath = specifier.endsWith(".ts") ? specifier.slice(2) : `${specifier.slice(2)}.ts`;
      return nextResolve(new URL(`../${localPath}`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const secret = "managed-research-bridge-secret";
const port = await availablePort();
const service = startManagedResearchService(port, secret);
const serviceUrl = `http://127.0.0.1:${port}`;

const previousEnv = snapshotEnv([
  "FORGE_MANAGED_RESEARCH_URL",
  "FORGE_MANAGED_RESEARCH_SECRET",
  "FORGE_MANAGED_RESEARCH_TIMEOUT_MS",
  "FORGE_RESEARCH_LIMIT_PER_SOURCE",
  "FORGE_RESEARCH_MAX_OPPORTUNITIES"
]);

try {
  await waitForHealth(serviceUrl, service);

  process.env.FORGE_MANAGED_RESEARCH_URL = serviceUrl;
  process.env.FORGE_MANAGED_RESEARCH_SECRET = secret;
  process.env.FORGE_MANAGED_RESEARCH_TIMEOUT_MS = "30000";
  process.env.FORGE_RESEARCH_LIMIT_PER_SOURCE = "2";
  process.env.FORGE_RESEARCH_MAX_OPPORTUNITIES = "1";

  const { runManagedBriefResearch } = await import("../lib/research/managed-research-client.ts");
  const result = await runManagedBriefResearch({
    project: {
      id: "bridge_project",
      name: "Managed bridge smoke",
      mode: "new_product",
      owner_user_id: "bridge_user",
      workspace_id: "bridge_workspace",
      description: "Verify dashboard-to-managed-research HTTP contract."
    },
    researchBrief: {
      id: "brief_bridge",
      project_id: "bridge_project",
      status: "approved",
      hypothesis: "Solo developers need a calmer way to turn AI product chats into research briefs.",
      target_users: ["solo developers"],
      pain_area: "AI product conversations lose nuance before research starts.",
      constraints: ["No paid APIs", "Do not use a fixed questionnaire"],
      source_plan: ["Public developer discussions", "GitHub issues"],
      disqualifying_evidence: ["Existing free tools preserve conversation context into research handoffs"],
      mvp_boundaries: ["Chat-to-research-brief audit trail"],
      user_taste_notes: ["Feels like a product partner, not an agent control room"],
      open_questions: ["Which developer segment repeats this pain weekly?"],
      confidence: 0.72
    }
  });

  if (!result) {
    throw new Error("Managed research bridge returned null.");
  }
  const requestScope = objectRecord(result.metadata.request_scope);
  assertEqual(result.metadata.status, "completed", "expected completed managed research status");
  assertEqual(requestScope?.owner_user_id, "bridge_user", "expected owner scope echo");
  assertEqual(requestScope?.workspace_id, "bridge_workspace", "expected workspace scope echo");
  assertAtLeast(result.signals.length, 1, "expected at least one normalized signal");
  assertAtLeast(result.opportunities.length, 1, "expected at least one normalized opportunity");

  const opportunity = result.opportunities[0];
  assertEqual(opportunity.profile?.origin, "managed_research_brief", "expected dashboard-managed origin");
  assertArrayIncludes(opportunity.profile?.constraints, "No paid APIs", "expected approved constraints to survive");
  assertArrayIncludes(
    opportunity.profile?.user_taste_notes,
    "Feels like a product partner, not an agent control room",
    "expected user taste notes to survive"
  );
  assertAtLeast(opportunity.evaluations?.length ?? 0, 1, "expected role-shaped evaluations");

  console.log(
    `[ok] Managed research bridge smoke reached ${serviceUrl}, mapped ${result.signals.length} signals and ${result.opportunities.length} opportunity.`
  );
} finally {
  restoreEnv(previousEnv);
  await stopProcess(service);
}

function startManagedResearchService(port: number, secretValue: string): ChildProcess {
  const serviceDir = path.resolve(process.cwd(), "../../services/managed_research");
  const child = spawn(
    "uv",
    ["run", "uvicorn", "forge_managed_research.api:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: serviceDir,
      env: {
        ...process.env,
        FORGE_MANAGED_RESEARCH_SECRET: secretValue,
        FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH: "0",
        FORGE_ENABLE_MANAGED_EVAL: "0",
        FORGE_REDDIT_SUBREDDITS: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a local TCP port."));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  let exited = false;
  let exitDetail = "";
  child.once("exit", (code, signal) => {
    exited = true;
    exitDetail = `Managed research service exited before health check: code=${String(code)} signal=${String(signal)}`;
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(exitDetail);
    }
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Retry until uvicorn finishes startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for managed research health at ${url}/health.`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      resolve();
    }, 2000).unref();
  });
}

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Map<string, string | undefined>): void {
  for (const [key, value] of values) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertAtLeast(actual: number, expected: number, message: string): void {
  if (actual < expected) {
    throw new Error(`${message}. Expected at least ${expected}, got ${actual}.`);
  }
}

function assertArrayIncludes(value: unknown, expected: string, message: string): void {
  if (!Array.isArray(value) || !value.includes(expected)) {
    throw new Error(`${message}. Missing ${expected}.`);
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
