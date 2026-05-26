type Env = Partial<Record<string, string | undefined>>;

const SAFE_CALLBACK_MESSAGES = new Set([
  "Email is not invited to this Forge workspace.",
  "Enter a valid email address.",
  "GitHub callback state could not be verified.",
  "Project not found for this GitHub callback.",
  "Session could not be completed.",
  "Sign in before connecting GitHub.",
  "Supabase session token could not be validated.",
  "SUPABASE_URL and SUPABASE_ANON_KEY are required for hosted sign-in."
]);

export function callbackSafeErrorMessage(
  reason: unknown,
  fallback: string,
  env: Env = process.env
): string {
  const message = reason instanceof Error ? reason.message : String(reason || "");
  const redacted = redactCallbackText(message, env).trim();
  if (redacted && redacted === message.trim() && SAFE_CALLBACK_MESSAGES.has(redacted)) {
    return redacted;
  }
  return fallback;
}

export function redactCallbackText(value: string, env: Env = process.env): string {
  let redacted = value;
  for (const secret of callbackSecretValues(env)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  redacted = redacted.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/((?:github_)?access_token\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(refresh_token\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/((?:api_)?key\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(secret\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(token\s*[:=]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]");
  return redacted.slice(0, 180);
}

function callbackSecretValues(env: Env): string[] {
  const secretNamePattern = /(?:SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE|API_KEY|DB_URL|AUTH_BEARER)/i;
  return Object.entries(env)
    .filter(([name, value]) => secretNamePattern.test(name) && typeof value === "string")
    .map(([, value]) => value?.trim() ?? "")
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);
}
