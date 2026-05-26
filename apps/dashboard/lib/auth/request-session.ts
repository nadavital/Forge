export type RequestAuthContext = {
  provider: "supabase";
  subject: string;
  email?: string | null;
  tokenSource: "authorization_header" | "cookie";
};

export const DEFAULT_AUTH_ACCESS_COOKIE = "forge_supabase_access_token";
export const DEFAULT_AUTH_REFRESH_COOKIE = "forge_supabase_refresh_token";

type Env = Partial<Record<string, string | undefined>>;

type RequestToken = {
  token?: string | null;
  source: RequestAuthContext["tokenSource"];
  refreshToken?: string | null;
};

export async function getRequestAuthContext(env: Env = process.env): Promise<RequestAuthContext | null> {
  const token = await getRequestBearerToken(env);
  if (!token) return null;
  if (token.token) {
    const context = await authContextFromBearerToken(token.token, token.source, env);
    if (context) return context;
  }

  if (token.source === "cookie" && token.refreshToken) {
    const refreshed = await refreshSupabaseAuthSession(token.refreshToken, env);
    if (refreshed?.accessToken) {
      return authContextFromBearerToken(refreshed.accessToken, "cookie", env);
    }
  }
  return null;
}

export async function getRequestRealtimeAccessToken(env: Env = process.env): Promise<string | null> {
  const token = await getRequestBearerToken(env);
  if (!token || token.source !== "cookie") return null;

  if (token.token) {
    const context = await authContextFromBearerToken(token.token, token.source, env);
    if (context) return token.token;
  }

  if (token.refreshToken) {
    const refreshed = await refreshSupabaseAuthSession(token.refreshToken, env);
    return refreshed?.accessToken ?? null;
  }

  return null;
}

export async function authContextFromBearerToken(
  token: string,
  source: RequestAuthContext["tokenSource"],
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RequestAuthContext | null> {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  const apikey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apikey) return null;

  const response = await fetchImpl(`${url}/auth/v1/user`, {
    headers: {
      apikey,
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { id?: unknown; sub?: unknown; email?: unknown };
  const subject = typeof payload.id === "string" ? payload.id : typeof payload.sub === "string" ? payload.sub : "";
  if (!subject) return null;
  return {
    provider: "supabase",
    subject,
    email: typeof payload.email === "string" ? payload.email : null,
    tokenSource: source
  };
}

export async function refreshSupabaseAuthSession(
  refreshToken: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; refreshToken?: string | null; expiresIn?: number | null } | null> {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  const apikey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const token = refreshToken.trim();
  if (!url || !apikey || !token) return null;

  const response = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: token }),
    cache: "no-store"
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof payload.access_token !== "string" || !payload.access_token.trim()) return null;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : null
  };
}

async function getRequestBearerToken(env: Env): Promise<RequestToken | null> {
  const request = await readNextRequestStores();
  const authorization = request.headers?.get("authorization") || request.headers?.get("Authorization");
  const headerToken = bearerTokenFromAuthorization(authorization);
  if (headerToken) {
    return { token: headerToken, source: "authorization_header" };
  }

  const configuredCookie = env.FORGE_AUTH_BEARER_COOKIE?.trim();
  const forgeRefreshToken = refreshTokenFromCookieValue(request.cookies?.get(DEFAULT_AUTH_REFRESH_COOKIE)?.value || "");
  for (const cookieName of [configuredCookie, DEFAULT_AUTH_ACCESS_COOKIE].filter(Boolean) as string[]) {
    const cookieToken = accessTokenFromCookieValue(request.cookies?.get(cookieName)?.value || "");
    if (cookieToken) {
      return { token: cookieToken, source: "cookie", refreshToken: forgeRefreshToken };
    }
  }

  if (forgeRefreshToken) {
    return { source: "cookie", refreshToken: forgeRefreshToken };
  }

  for (const cookie of request.cookies?.getAll() || []) {
    if (!cookie.name.startsWith("sb-") || !cookie.name.includes("auth-token")) continue;
    const cookieToken = accessTokenFromCookieValue(cookie.value);
    if (cookieToken) {
      return { token: cookieToken, source: "cookie", refreshToken: refreshTokenFromCookieValue(cookie.value) };
    }
  }
  return null;
}

async function readNextRequestStores(): Promise<{
  headers?: { get(name: string): string | null };
  cookies?: { get(name: string): { value: string } | undefined; getAll(): Array<{ name: string; value: string }> };
}> {
  try {
    const mod = await import("next/headers");
    return {
      headers: await mod.headers(),
      cookies: await mod.cookies()
    };
  } catch {
    return {};
  }
}

function bearerTokenFromAuthorization(value: string | null | undefined): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function accessTokenFromCookieValue(value: string): string | null {
  const decoded = safeDecodeURIComponent(value.trim());
  if (!decoded) return null;
  const normalized = decoded.startsWith("base64-") ? decodeBase64Url(decoded.slice("base64-".length)) : decoded;
  if (!normalized) return null;
  const rawToken = jwtLikeToken(normalized);
  if (rawToken) return rawToken;

  const parsed = safeJsonParse(normalized);
  return accessTokenFromParsedCookie(parsed);
}

export function refreshTokenFromCookieValue(value: string): string | null {
  const decoded = safeDecodeURIComponent(value.trim());
  if (!decoded) return null;
  const normalized = decoded.startsWith("base64-") ? decodeBase64Url(decoded.slice("base64-".length)) : decoded;
  if (!normalized) return null;

  const parsed = safeJsonParse(normalized);
  const parsedRefreshToken = refreshTokenFromParsedCookie(parsed);
  if (parsedRefreshToken) return parsedRefreshToken;

  return normalized.includes("{") || normalized.includes("[") ? null : normalized;
}

function accessTokenFromParsedCookie(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return jwtLikeToken(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = accessTokenFromParsedCookie(item);
      if (token) return token;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.access_token === "string") return jwtLikeToken(record.access_token);
    if (record.currentSession) return accessTokenFromParsedCookie(record.currentSession);
    if (record.session) return accessTokenFromParsedCookie(record.session);
  }
  return null;
}

function refreshTokenFromParsedCookie(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = refreshTokenFromParsedCookie(item);
      if (token) return token;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.refresh_token === "string" && record.refresh_token.trim()) return record.refresh_token.trim();
    if (record.currentSession) return refreshTokenFromParsedCookie(record.currentSession);
    if (record.session) return refreshTokenFromParsedCookie(record.session);
  }
  return null;
}

function jwtLikeToken(value: string): string | null {
  const token = value.trim();
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}
