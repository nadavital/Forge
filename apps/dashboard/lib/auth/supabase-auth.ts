import {
  DEFAULT_AUTH_ACCESS_COOKIE,
  DEFAULT_AUTH_REFRESH_COOKIE,
  authContextFromBearerToken
} from "./request-session.ts";

export const AUTH_REFRESH_COOKIE = DEFAULT_AUTH_REFRESH_COOKIE;

type Env = Partial<Record<string, string | undefined>>;

export type AuthSessionCookie = {
  name: string;
  value: string;
  maxAge: number;
};

export type AuthSessionUser = {
  subject: string;
  email?: string | null;
};

export type AuthSessionCookieSet = {
  access: AuthSessionCookie;
  refresh?: AuthSessionCookie;
  user: AuthSessionUser;
};

export function isSupabaseAuthConfigured(env: Env = process.env): boolean {
  return Boolean(cleanEnv(env.SUPABASE_URL) && cleanEnv(env.SUPABASE_ANON_KEY));
}

export function isHostedAuthRequired(env: Env = process.env): boolean {
  return ["1", "true", "yes"].includes((env.FORGE_REQUIRE_AUTH || "").toLowerCase());
}

export async function requestSupabaseMagicLink(input: {
  email: string;
  redirectTo: string;
  env?: Env;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const env = input.env ?? process.env;
  const url = cleanEnv(env.SUPABASE_URL)?.replace(/\/$/, "");
  const anonKey = cleanEnv(env.SUPABASE_ANON_KEY);
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for hosted sign-in.");
  }
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      type: "magiclink",
      options: {
        email_redirect_to: input.redirectTo
      }
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase magic-link request failed: ${response.status} ${body.slice(0, 180)}`);
  }
}

export async function validatedSessionCookies(input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  env?: Env;
}): Promise<AuthSessionCookieSet> {
  const accessToken = input.accessToken.trim();
  const context = await authContextFromBearerToken(accessToken, "cookie", input.env ?? process.env);
  if (!context) {
    throw new Error("Supabase session token could not be validated.");
  }
  const accessMaxAge = clampSeconds(input.expiresIn, 60, 60 * 60 * 24 * 7) ?? 60 * 60;
  const refreshToken = input.refreshToken?.trim();
  return {
    access: {
      name: DEFAULT_AUTH_ACCESS_COOKIE,
      value: accessToken,
      maxAge: accessMaxAge
    },
    refresh: refreshToken
      ? {
          name: AUTH_REFRESH_COOKIE,
          value: refreshToken,
          maxAge: 60 * 60 * 24 * 30
        }
      : undefined,
    user: {
      subject: context.subject,
      email: context.email ?? null
    }
  };
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function clampSeconds(value: number | null | undefined, min: number, max: number): number | null {
  if (!Number.isFinite(value) || !value) return null;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
