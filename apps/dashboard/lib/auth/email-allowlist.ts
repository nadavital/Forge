type Env = Partial<Record<string, string | undefined>>;

export const EMAIL_NOT_INVITED_MESSAGE = "Email is not invited to this Forge workspace.";

export function assertEmailAllowed(email: string | null | undefined, env: Env = process.env): void {
  if (!emailAllowed(email, env)) {
    throw new Error(EMAIL_NOT_INVITED_MESSAGE);
  }
}

export function emailAllowed(email: string | null | undefined, env: Env = process.env): boolean {
  const allowedEmails = configuredList(env.FORGE_ALLOWED_EMAILS);
  const allowedDomains = configuredList(env.FORGE_ALLOWED_EMAIL_DOMAINS).map((domain) => domain.replace(/^@/, ""));
  if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;

  const normalized = email?.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;
  const domain = normalized.split("@").at(-1) || "";

  return allowedEmails.includes(normalized) || allowedDomains.includes(domain);
}

export function emailAllowlistConfigured(env: Env = process.env): boolean {
  return configuredList(env.FORGE_ALLOWED_EMAILS).length > 0 || configuredList(env.FORGE_ALLOWED_EMAIL_DOMAINS).length > 0;
}

function configuredList(value: string | undefined): string[] {
  return (value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
