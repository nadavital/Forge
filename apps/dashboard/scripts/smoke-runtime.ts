#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRuntimeHandoff, formatRuntimeHandoff } from "../lib/runtime/handoff.ts";
import { checkRuntimeHealth } from "../lib/runtime/health.ts";

type CliOptions = {
  strict: boolean;
  json: boolean;
  envFile: string | null;
  handoff: boolean;
};

const options = parseArgs(process.argv.slice(2));
loadEnvFile(options.envFile ?? ".env.local");

const result = await checkRuntimeHealth({
  authBearerToken: process.env.FORGE_SMOKE_AUTH_BEARER
});

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Forge runtime smoke (${result.checkedAt})`);
  for (const item of result.items) {
    const detail = item.detail ? ` ${item.detail}` : "";
    console.log(`${statusMark(item.status)} ${item.label}: ${item.summary}${detail}`);
  }
  if (options.handoff) {
    const actions = buildRuntimeHandoff(result);
    if (actions.length) {
      console.log("");
      console.log(formatRuntimeHandoff(actions));
    }
  }
}

const failed = options.strict
  ? result.items.some((item) => item.status !== "ok")
  : result.items.some((item) => item.status === "error");

if (failed) {
  process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    strict: false,
    json: false,
    envFile: null,
    handoff: true
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--no-handoff") {
      options.handoff = false;
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

function statusMark(status: string): string {
  if (status === "ok") return "[ok]";
  if (status === "warning") return "[warn]";
  if (status === "error") return "[error]";
  return "[skip]";
}

function printHelp(): void {
  console.log(`Usage: pnpm smoke:runtime [--strict] [--json] [--no-handoff] [--env-file <path>]

Checks Forge's configured live runtime paths without printing secret values.

Options:
  --strict          Fail unless every readiness item returns ok.
  --json            Print the raw non-secret health result as JSON.
  --no-handoff      Do not print hosted setup next actions for non-ready paths.
  --env-file PATH   Load env vars from PATH before checking. Defaults to .env.local.

Set FORGE_SMOKE_AUTH_BEARER in the environment to validate a Supabase Auth bearer token from the CLI.`);
}
