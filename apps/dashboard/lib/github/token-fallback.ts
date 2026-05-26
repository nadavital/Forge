import { isHostedAuthRequired } from "../auth/supabase-auth.ts";

type Env = Partial<Record<string, string | undefined>>;

export function githubTokenFallbackEnabled(env: Env = process.env): boolean {
  return explicitGitHubTokenFallbackEnabled(env) && !isHostedAuthRequired(env) && Boolean(rawGitHubTokenFromEnv(env));
}

export function githubTokenFromEnv(env: Env = process.env): string | null {
  if (!githubTokenFallbackEnabled(env)) {
    return null;
  }
  return rawGitHubTokenFromEnv(env);
}

function rawGitHubTokenFromEnv(env: Env = process.env): string | null {
  return cleanEnv(env.FORGE_GITHUB_TOKEN) ?? cleanEnv(env.GITHUB_TOKEN) ?? null;
}

export function explicitGitHubTokenFallbackEnabled(env: Env = process.env): boolean {
  return ["1", "true", "yes"].includes((env.FORGE_ALLOW_GITHUB_TOKEN_FALLBACK || "").toLowerCase());
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}
