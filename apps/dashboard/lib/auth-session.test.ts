import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accessTokenFromCookieValue,
  authContextFromBearerToken,
  getRequestRealtimeAccessToken,
  refreshSupabaseAuthSession,
  refreshTokenFromCookieValue
} from "./auth/request-session.ts";
import { requestSupabaseMagicLink, validatedSessionCookies } from "./auth/supabase-auth.ts";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature";

test("request auth extracts Supabase SSR cookie access tokens", () => {
  const payload = Buffer.from(JSON.stringify({ currentSession: { access_token: jwt } }), "utf8")
    .toString("base64url");

  assert.equal(accessTokenFromCookieValue(`base64-${payload}`), jwt);
  assert.equal(accessTokenFromCookieValue(encodeURIComponent(JSON.stringify({ access_token: jwt }))), jwt);
  assert.equal(accessTokenFromCookieValue(jwt), jwt);
});

test("request auth extracts refresh tokens from Forge and Supabase cookies", () => {
  const payload = Buffer.from(
    JSON.stringify({ currentSession: { access_token: jwt, refresh_token: "refresh-token" } }),
    "utf8"
  ).toString("base64url");

  assert.equal(refreshTokenFromCookieValue(`base64-${payload}`), "refresh-token");
  assert.equal(refreshTokenFromCookieValue(encodeURIComponent(JSON.stringify({ refresh_token: "refresh-token" }))), "refresh-token");
  assert.equal(refreshTokenFromCookieValue("opaque-refresh-token"), "opaque-refresh-token");
});

test("request auth validates bearer tokens with Supabase Auth", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  let apikey = "";

  try {
    globalThis.fetch = (async (url, init) => {
      requestedUrl = String(url);
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization") || "";
      apikey = headers.get("apikey") || "";
      return Response.json({ id: "auth-user-1", email: "owner@example.com" });
    }) as typeof fetch;

    const context = await authContextFromBearerToken(jwt, "cookie", {
      SUPABASE_URL: "https://forge.supabase.co/",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key"
    });

    assert.equal(requestedUrl, "https://forge.supabase.co/auth/v1/user");
    assert.equal(authorization, `Bearer ${jwt}`);
    assert.equal(apikey, "anon-key");
    assert.deepEqual(context, {
      provider: "supabase",
      subject: "auth-user-1",
      email: "owner@example.com",
      tokenSource: "cookie"
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("request auth can refresh expired Supabase access cookies", async () => {
  const requested: Array<{ url: string; body: string; apikey: string }> = [];

  const refreshed = await refreshSupabaseAuthSession(
    "refresh-token",
    {
      SUPABASE_URL: "https://forge.supabase.co/",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key"
    },
    (async (url, init) => {
      const headers = new Headers(init?.headers);
      requested.push({
        url: String(url),
        body: String(init?.body || ""),
        apikey: headers.get("apikey") || ""
      });
      return Response.json({
        access_token: jwt,
        refresh_token: "new-refresh-token",
        expires_in: 3600
      });
    }) as typeof fetch
  );

  assert.equal(requested[0].url, "https://forge.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.equal(requested[0].apikey, "anon-key");
  assert.deepEqual(JSON.parse(requested[0].body), { refresh_token: "refresh-token" });
  assert.deepEqual(refreshed, {
    accessToken: jwt,
    refreshToken: "new-refresh-token",
    expiresIn: 3600
  });
});

test("request auth fallback uses refresh cookies after access validation fails", () => {
  const source = readFileSync(new URL("./auth/request-session.ts", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("export async function getRequestAuthContext"),
    source.indexOf("export async function authContextFromBearerToken")
  );
  const tokenExtractor = source.slice(
    source.indexOf("async function getRequestBearerToken"),
    source.indexOf("async function readNextRequestStores")
  );

  assert.match(body, /authContextFromBearerToken\(token\.token, token\.source, env\)/);
  assert.match(body, /token\.source === "cookie" && token\.refreshToken/);
  assert.match(body, /refreshSupabaseAuthSession\(token\.refreshToken, env\)/);
  assert.match(tokenExtractor, /if \(forgeRefreshToken\) \{\s*return \{ source: "cookie", refreshToken: forgeRefreshToken \};\s*\}/);
});

test("request realtime access token helper is available for authenticated realtime only", () => {
  const source = readFileSync(new URL("./auth/request-session.ts", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("export async function getRequestRealtimeAccessToken"),
    source.indexOf("export async function authContextFromBearerToken")
  );

  assert.equal(typeof getRequestRealtimeAccessToken, "function");
  assert.match(body, /token\.source !== "cookie"/);
  assert.match(body, /authContextFromBearerToken\(token\.token, token\.source, env\)/);
  assert.match(body, /refreshSupabaseAuthSession\(token\.refreshToken, env\)/);
  assert.doesNotMatch(body, /source === "authorization_header"/);
});

test("request auth does not refresh authorization-header tokens", () => {
  const source = readFileSync(new URL("./auth/request-session.ts", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("export async function getRequestAuthContext"),
    source.indexOf("export async function authContextFromBearerToken")
  );

  assert.doesNotMatch(body, /token\.source === "authorization_header" && token\.refreshToken/);
});

test("requesting magic links uses Supabase Auth without exposing service-role credentials", async () => {
  let requestedUrl = "";
  let apikey = "";
  let body = "";

  await requestSupabaseMagicLink({
    email: "Owner@Example.com ",
    redirectTo: "https://forge.example.com/auth/callback",
    env: {
      SUPABASE_URL: "https://forge.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: (async (url, init) => {
      requestedUrl = String(url);
      const headers = new Headers(init?.headers);
      apikey = headers.get("apikey") || "";
      body = String(init?.body || "");
      return new Response("{}", { status: 200 });
    }) as typeof fetch
  });

  assert.equal(requestedUrl, "https://forge.supabase.co/auth/v1/otp");
  assert.equal(apikey, "anon-key");
  assert.doesNotMatch(body, /service-role/);
  assert.deepEqual(JSON.parse(body), {
    email: "owner@example.com",
    type: "magiclink",
    options: {
      email_redirect_to: "https://forge.example.com/auth/callback"
    }
  });
});

test("validated sessions produce httpOnly cookie inputs after Supabase token validation", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ id: "auth-user-1", email: "owner@example.com" })) as typeof fetch;

    const cookies = await validatedSessionCookies({
      accessToken: jwt,
      refreshToken: "refresh-token",
      expiresIn: 3600,
      env: {
        SUPABASE_URL: "https://forge.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      }
    });

    assert.equal(cookies.access.name, "forge_supabase_access_token");
    assert.equal(cookies.access.value, jwt);
    assert.equal(cookies.access.maxAge, 3600);
    assert.equal(cookies.refresh?.name, "forge_supabase_refresh_token");
    assert.equal(cookies.user.email, "owner@example.com");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("active identity prefers request auth before env auth subjects", () => {
  const source = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
  const identityBody = source.slice(
    source.indexOf("export async function getActiveIdentity"),
    source.indexOf("async function resolveSupabaseAuthSubjectIdentity")
  );

  assert.match(identityBody, /const requestAuth = await getRequestAuthContext\(\)/);
  assert.match(identityBody, /const authSubject = requestAuth\?\.subject \?\? cleanEnv\(process\.env\.FORGE_AUTH_SUBJECT\)/);
  assert.match(identityBody, /workspace_\$\{requestAuth\.subject\}/);
});

test("hosted auth enforcement redirects before loading project data when required", () => {
  const source = readFileSync(new URL("../app/(app)/layout.tsx", import.meta.url), "utf8");

  assert.match(source, /isHostedAuthRequired\(\) && !authSession\.signedIn/);
  assert.match(source, /redirect\("\/login"\)/);
  assert.ok(
    source.indexOf("redirect(\"/login\")") < source.indexOf("loadDashboardProjects()"),
    "auth-required redirect must happen before loading scoped project data"
  );
});

test("repository refuses fallback identity when hosted auth is required", () => {
  const source = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
  const identityBody = source.slice(
    source.indexOf("export async function getActiveIdentity"),
    source.indexOf("async function resolveSupabaseAuthSubjectIdentity")
  );

  assert.match(identityBody, /isHostedAuthRequired\(\) && !requestAuth/);
  assert.match(identityBody, /FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=1/);
  assert.ok(
    identityBody.indexOf("isHostedAuthRequired() && !requestAuth") < identityBody.indexOf("return {"),
    "auth-required guard must happen before fallback identity return"
  );
});

test("auth session view avoids loading fallback identity before auth-required redirect", () => {
  const source = readFileSync(new URL("./dashboard-data.ts", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("export async function loadAuthSessionView"),
    source.indexOf("export async function loadSchedulerOverview")
  );

  assert.match(body, /if \(!requestAuth && isHostedAuthRequired\(\)\)/);
  assert.ok(
    body.indexOf("if (!requestAuth && isHostedAuthRequired())") < body.indexOf("const identity = await getActiveIdentity()"),
    "auth session view must return unauthenticated state before calling getActiveIdentity"
  );
});

test("GitHub callback redirects to login before project lookup or connection writes when hosted auth is required", () => {
  const source = readFileSync(new URL("../app/(app)/github/callback/page.tsx", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("export default async function GitHubCallbackPage"),
    source.indexOf("if (installationId)")
  );

  assert.match(body, /const requestAuth = await getRequestAuthContext\(\)/);
  assert.match(body, /!requestAuth && isHostedAuthRequired\(\) && \(projectId \|\| installationId \|\| code\)/);
  assert.match(body, /redirectUrl\.pathname = "\/login"/);
  assert.ok(
    body.indexOf("!requestAuth && isHostedAuthRequired()") < body.indexOf("const bundle = await getProjectBundle(projectId)"),
    "hosted GitHub callbacks must require a signed-in session before loading project data"
  );
  assert.ok(
    source.indexOf("!requestAuth && isHostedAuthRequired()") < source.indexOf("if (installationId)"),
    "hosted GitHub callbacks must require a signed-in session before writing connection data"
  );
});

test("auth callback clears returned Supabase tokens before server validation", () => {
  const source = readFileSync(new URL("../components/auth/AuthCallbackClient.tsx", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("useEffect(() => {"),
    source.indexOf("  }, [router]);")
  );

  assert.match(body, /window\.history\.replaceState\(null, "", "\/auth\/callback"\)/);
  assert.ok(
    body.indexOf("window.history.replaceState") < body.indexOf("completeSupabaseAuthAction"),
    "auth callback should remove access and refresh tokens from the URL before async validation can fail"
  );
});

test("auth actions do not return raw provider errors to callback UI", () => {
  const source = readFileSync(new URL("../app/actions/auth.ts", import.meta.url), "utf8");

  assert.match(source, /callbackSafeErrorMessage\(reason, "Sign-in link could not be sent\."\)/);
  assert.match(source, /callbackSafeErrorMessage\(reason, "Session could not be completed\."\)/);
  assert.doesNotMatch(source, /reason instanceof Error \? reason\.message/);
});
