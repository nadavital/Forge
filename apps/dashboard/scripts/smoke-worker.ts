#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type CliOptions = {
  envFile: string | null;
  json: boolean;
  url: string | null;
};

type ProbeResult = {
  ok: boolean;
  url: string;
  statusCode?: number;
  responseMode?: string;
  error?: string;
  detail?: string;
};

const options = parseArgs(process.argv.slice(2));
loadEnvFile(options.envFile ?? ".env.local");

const appUrl = cleanEnv(options.url) ?? cleanEnv(process.env.FORGE_PUBLIC_APP_URL);
const workerSecret = cleanEnv(process.env.FORGE_PIPELINE_WORKER_SECRET) ?? cleanEnv(process.env.CRON_SECRET);

if (!appUrl) {
  fail({
    ok: false,
    url: "",
    error: "Missing app URL.",
    detail: "Set FORGE_PUBLIC_APP_URL or pass --url."
  });
}

if (!workerSecret) {
  fail({
    ok: false,
    url: normalizeAppUrl(appUrl),
    error: "Missing worker secret.",
    detail: "Set FORGE_PIPELINE_WORKER_SECRET or CRON_SECRET."
  });
}

const result = await probeWorker(normalizeAppUrl(appUrl), workerSecret);
if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  const mode = result.responseMode ? ` mode=${result.responseMode}` : "";
  console.log(`[ok] Pipeline worker probe accepted at ${result.url}${mode}`);
} else {
  console.error(`[error] Pipeline worker probe failed at ${result.url}: ${result.error}`);
  if (result.detail) {
    console.error(result.detail);
  }
}

if (!result.ok) {
  process.exitCode = 1;
}

async function probeWorker(appUrl: string, secret: string): Promise<ProbeResult> {
  const endpoint = `${appUrl}/api/pipeline/worker`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ probe: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(Number(process.env.FORGE_PIPELINE_WORKER_HEALTH_TIMEOUT_MS || 5000))
    });
    const body = await response.text();
    const parsed = parseJsonBody(body);
    if (!response.ok) {
      return {
        ok: false,
        url: endpoint,
        statusCode: response.status,
        error: `HTTP ${response.status}`,
        detail: redactSecrets(body.slice(0, 240), secret)
      };
    }
    return {
      ok: true,
      url: endpoint,
      statusCode: response.status,
      responseMode: typeof parsed?.mode === "string" ? parsed.mode : undefined
    };
  } catch (reason) {
    return {
      ok: false,
      url: endpoint,
      error: reason instanceof Error ? reason.message : String(reason)
    };
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    envFile: null,
    json: false,
    url: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--url") {
      options.url = args[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--env-file") {
      options.envFile = args[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function loadEnvFile(path: string): void {
  const absolutePath = resolve(process.cwd(), path);
  if (!existsSync(absolutePath)) return;

  const body = readFileSync(absolutePath, "utf8");
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function cleanEnv(value: string | null | undefined): string | null {
  const cleanValue = value?.trim();
  return cleanValue ? cleanValue : null;
}

function normalizeAppUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function parseJsonBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function redactSecrets(value: string, secret: string): string {
  return secret ? value.split(secret).join("[redacted]") : value;
}

function fail(result: ProbeResult): never {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`[error] ${result.error}`);
    if (result.detail) {
      console.error(result.detail);
    }
  }
  process.exit(1);
}

function printHelp(): void {
  console.log(`Usage: pnpm worker:probe [--url <app-url>] [--json] [--env-file <path>]

POSTs a bearer-authenticated {"probe":true} request to /api/pipeline/worker.
The probe validates worker routing/auth and does not process queued runs.

Options:
  --url URL        App base URL. Defaults to FORGE_PUBLIC_APP_URL.
  --json           Print the non-secret probe result as JSON.
  --env-file PATH  Load env vars from PATH before probing. Defaults to .env.local.`);
}
