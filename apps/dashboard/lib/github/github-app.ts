import { createHmac, createSign, randomBytes, timingSafeEqual } from "crypto";
import type { DbGitHubConnection } from "../db/types.ts";

type Env = Partial<Record<string, string | undefined>>;

type InstallationAccount = {
  login: string;
  type?: "User" | "Organization";
  permissions: Record<string, string>;
};

export type GitHubInstallationRepository = {
  id: number;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  defaultBranch?: string | null;
};

export type GitHubInstallationAccess = {
  token: string;
  expiresAt?: string | null;
  permissions: Record<string, string>;
  repositorySelection?: string | null;
};

export type GitHubUserAccess = {
  token: string;
  tokenType?: string | null;
  expiresAt?: string | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: string | null;
  scopes: string[];
};

export type GitHubUserProfile = {
  login: string;
  type?: "User" | "Organization";
};

export type GitHubConnectionHealth = {
  accountLogin: string;
  authSource: "github_app" | "github_oauth";
  expiresAt?: string | null;
  permissions: Record<string, string>;
  repositorySelection?: string | null;
  repositoryCount: number;
};

export type GitHubAppConfigurationHealth = {
  id?: number | null;
  slug?: string | null;
  name?: string | null;
  owner?: string | null;
  permissions?: Record<string, string>;
};

export type GitHubInstallationWebhookUpdate = {
  installationId: string;
  status: DbGitHubConnection["status"];
};

export type ParsedGitHubCallbackState = {
  projectId: string | null;
  verified: boolean;
  invalid: boolean;
  reason?: "missing_secret" | "malformed" | "signature_mismatch" | "expired";
};

export class GitHubAppRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "GitHubAppRequestError";
    this.status = status;
    this.path = path;
  }
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

export function isGitHubUserOAuthConfigured(): boolean {
  return Boolean(gitHubOAuthClientId() && gitHubOAuthClientSecret());
}

export function isGitHubDevelopmentFallbackEnabled(env: Env = process.env): boolean {
  return ["1", "true", "yes"].includes((env.FORGE_ENABLE_GITHUB_DEV_FALLBACK || "").toLowerCase());
}

export function isGitHubInstallationGoneError(error: unknown): boolean {
  return (
    error instanceof GitHubAppRequestError &&
    error.status === 404 &&
    error.path.startsWith("/app/installations/")
  );
}

export function githubAppInstallUrl(projectId?: string | null, env: Env = process.env): string | null {
  const slug = env.GITHUB_APP_SLUG;
  if (!slug) return null;
  if (projectId && requiresSignedGitHubState(env) && !githubCallbackStateSecret(env)) {
    return null;
  }
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  const state = githubCallbackState(projectId, env);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export function githubUserAuthorizationUrl(projectId?: string | null, env: Env = process.env): string | null {
  const clientId = gitHubOAuthClientId(env);
  if (!clientId) return null;
  if (projectId && requiresSignedGitHubState(env) && !githubCallbackStateSecret(env)) {
    return null;
  }
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  const state = githubCallbackState(projectId, env);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export function githubCallbackState(
  projectId?: string | null,
  env: Env = process.env
): string | undefined {
  const cleanProjectId = projectId?.trim();
  if (!cleanProjectId) {
    return undefined;
  }
  const secret = githubCallbackStateSecret(env);
  if (!secret) {
    if (requiresSignedGitHubState(env)) {
      return undefined;
    }
    return cleanProjectId;
  }
  const payload = base64Url(
    JSON.stringify({
      projectId: cleanProjectId,
      nonce: randomBytes(12).toString("hex"),
      issuedAt: new Date().toISOString()
    })
  );
  const signature = createHmac("sha256", secret).update(payload).digest();
  return `forge:v1:${payload}:${base64Url(signature)}`;
}

export function parseGitHubCallbackState(
  state?: string | null,
  env: Env = process.env
): ParsedGitHubCallbackState {
  const rawState = state?.trim();
  if (!rawState) {
    return { projectId: null, verified: false, invalid: false };
  }
  const secret = githubCallbackStateSecret(env);
  if (!rawState.startsWith("forge:v1:")) {
    if (requiresSignedGitHubState(env)) {
      return { projectId: null, verified: false, invalid: true, reason: "missing_secret" };
    }
    return { projectId: rawState, verified: false, invalid: false };
  }
  if (!secret) {
    return { projectId: null, verified: false, invalid: true, reason: "missing_secret" };
  }

  const [, version, payload, signature] = rawState.split(":");
  if (version !== "v1" || !payload || !signature) {
    return { projectId: null, verified: false, invalid: true, reason: "malformed" };
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = base64UrlDecode(signature);
  if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { projectId: null, verified: false, invalid: true, reason: "signature_mismatch" };
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)?.toString("utf8") ?? "{}") as {
      projectId?: unknown;
      issuedAt?: unknown;
    };
    const projectId = typeof parsed.projectId === "string" && parsed.projectId.trim() ? parsed.projectId.trim() : null;
    if (!projectId) {
      return { projectId: null, verified: false, invalid: true, reason: "malformed" };
    }
    if (githubCallbackStateExpired(parsed.issuedAt, env)) {
      return { projectId: null, verified: false, invalid: true, reason: "expired" };
    }
    return { projectId, verified: true, invalid: false };
  } catch {
    return { projectId: null, verified: false, invalid: true, reason: "malformed" };
  }
}

export function verifyGitHubWebhookSignature(input: {
  body: string;
  signatureHeader?: string | null;
  secret?: string | null;
}): boolean {
  const signature = input.signatureHeader?.trim();
  const secret = input.secret?.trim();
  if (!signature || !secret || !signature.startsWith("sha256=")) {
    return false;
  }
  const actual = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(input.body).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function githubInstallationStatusForWebhook(
  event: string | null | undefined,
  payload: unknown
): GitHubInstallationWebhookUpdate | null {
  if (event !== "installation") {
    return null;
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const action = typeof body?.action === "string" ? body.action : "";
  const installation = body?.installation && typeof body.installation === "object"
    ? (body.installation as Record<string, unknown>)
    : null;
  const installationId = installation?.id;
  const id = typeof installationId === "number" || typeof installationId === "string" ? String(installationId) : "";
  if (!id) {
    return null;
  }

  if (action === "deleted") {
    return { installationId: id, status: "revoked" };
  }
  if (action === "suspend") {
    return { installationId: id, status: "needs_reauth" };
  }
  if (action === "created" || action === "unsuspend" || action === "new_permissions_accepted") {
    return { installationId: id, status: "active" };
  }
  return null;
}

export async function fetchGitHubInstallationAccount(installationId: string): Promise<InstallationAccount> {
  const installation = await githubAppRequest<{
    account?: { login?: string; type?: string };
    permissions?: Record<string, string>;
  }>(`/app/installations/${encodeURIComponent(installationId)}`);
  const login = installation.account?.login;
  if (!login) {
    throw new Error("GitHub installation response did not include an account login.");
  }
  const type = installation.account?.type === "Organization" ? "Organization" : "User";
  return { login, type, permissions: installation.permissions ?? {} };
}

export function githubPermissionScopes(permissions?: Record<string, string>): string[] {
  return Object.entries(permissions ?? {})
    .filter(([name, level]) => Boolean(name.trim()) && Boolean(level.trim()))
    .map(([name, level]) => `${name.trim()}:${level.trim()}`)
    .sort((a, b) => a.localeCompare(b));
}

export async function checkGitHubAppConfiguration(env: Env = process.env): Promise<GitHubAppConfigurationHealth> {
  const app = await githubAppRequest<{
    id?: number;
    slug?: string | null;
    name?: string | null;
    owner?: { login?: string | null };
    permissions?: Record<string, string>;
  }>("/app", {}, env);
  return {
    id: app.id ?? null,
    slug: app.slug ?? null,
    name: app.name ?? null,
    owner: app.owner?.login ?? null,
    permissions: app.permissions ?? {}
  };
}

export async function installationTokenForConnection(connection?: DbGitHubConnection): Promise<string | null> {
  const access = await installationAccessForConnection(connection);
  return access?.token ?? null;
}

export async function userAccessTokenForConnection(
  connection?: DbGitHubConnection
): Promise<string | null> {
  if (!connection?.id || connection.status !== "active" || connection.provider !== "github_oauth") {
    return null;
  }
  const { getGitHubUserTokenForConnection, upsertGitHubUserToken } = await import("../db/repository.ts");
  const row = await getGitHubUserTokenForConnection(connection.id);
  if (!row?.access_token) {
    return null;
  }
  if (!tokenExpiresSoon(row.expires_at)) {
    return row.access_token;
  }
  if (!row.refresh_token || tokenExpiresSoon(row.refresh_token_expires_at)) {
    return null;
  }
  const refreshed = await refreshGitHubUserAccess(row.refresh_token);
  await upsertGitHubUserToken({
    connectionId: connection.id,
    accessToken: refreshed.token,
    tokenType: refreshed.tokenType,
    expiresAt: refreshed.expiresAt,
    refreshToken: refreshed.refreshToken,
    refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
    scopes: refreshed.scopes
  });
  return refreshed.token;
}

export async function accessTokenForConnection(connection?: DbGitHubConnection): Promise<string | null> {
  if (connection?.provider === "github_oauth") {
    return userAccessTokenForConnection(connection);
  }
  return installationTokenForConnection(connection);
}

export async function exchangeGitHubUserCode(code: string): Promise<GitHubUserAccess> {
  const clientId = gitHubOAuthClientId();
  const clientSecret = gitHubOAuthClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET are required for GitHub user OAuth.");
  }
  return exchangeGitHubOAuthToken({
    client_id: clientId,
    client_secret: clientSecret,
    code
  });
}

export async function fetchGitHubUserProfile(token: string): Promise<GitHubUserProfile> {
  const user = await githubUserRequest<{ login?: string; type?: string }>("/user", token);
  if (!user.login) {
    throw new Error("GitHub user response did not include a login.");
  }
  return {
    login: user.login,
    type: user.type === "Organization" ? "Organization" : "User"
  };
}

export async function installationAccessForConnection(
  connection?: DbGitHubConnection
): Promise<GitHubInstallationAccess | null> {
  if (!connection?.installation_id || connection.status !== "active") {
    return null;
  }
  if (!isGitHubAppConfigured()) {
    return null;
  }

  const payload = await githubAppRequest<{
    token?: string;
    expires_at?: string | null;
    permissions?: Record<string, string>;
    repository_selection?: string | null;
  }>(
    `/app/installations/${encodeURIComponent(connection.installation_id)}/access_tokens`,
    { method: "POST" }
  );
  if (!payload.token) {
    return null;
  }
  return {
    token: payload.token,
    expiresAt: payload.expires_at ?? null,
    permissions: payload.permissions ?? {},
    repositorySelection: payload.repository_selection ?? null
  };
}

async function refreshGitHubUserAccess(refreshToken: string): Promise<GitHubUserAccess> {
  const clientId = gitHubOAuthClientId();
  const clientSecret = gitHubOAuthClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET are required to refresh GitHub user access.");
  }
  return exchangeGitHubOAuthToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
}

async function exchangeGitHubOAuthToken(params: Record<string, string>): Promise<GitHubUserAccess> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Forge GitHub App"
    },
    body: new URLSearchParams(params),
    cache: "no-store"
  });
  const payload = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `GitHub OAuth token exchange failed with ${response.status}.`);
  }
  return {
    token: payload.access_token,
    tokenType: payload.token_type ?? "bearer",
    expiresAt: secondsFromNow(payload.expires_in),
    refreshToken: payload.refresh_token ?? null,
    refreshTokenExpiresAt: secondsFromNow(payload.refresh_token_expires_in),
    scopes: splitScopes(payload.scope)
  };
}

export async function listInstallationRepositories(
  connection: DbGitHubConnection
): Promise<GitHubInstallationRepository[]> {
  if (connection.provider === "github_oauth") {
    const token = await userAccessTokenForConnection(connection);
    if (!token) {
      throw new Error("GitHub user OAuth access is not configured for this connection.");
    }
    return listUserRepositoriesWithToken(token);
  }
  const access = await installationAccessForConnection(connection);
  if (!access) {
    throw new Error("GitHub App installation access is not configured for this connection.");
  }
  return listInstallationRepositoriesWithToken(access.token);
}

export async function checkGitHubConnectionHealth(
  connection: DbGitHubConnection
): Promise<GitHubConnectionHealth> {
  if (connection.provider === "github_oauth") {
    const token = await userAccessTokenForConnection(connection);
    if (!token) {
      throw new Error("GitHub user OAuth access is not configured for this connection.");
    }
    const repositories = await listUserRepositoriesWithToken(token);
    return {
      accountLogin: connection.account_login,
      authSource: "github_oauth",
      permissions: { scopes: (connection.scopes ?? []).join(",") },
      repositorySelection: "oauth_user",
      repositoryCount: repositories.length
    };
  }

  const access = await installationAccessForConnection(connection);
  if (!access) {
    throw new Error("GitHub App installation access is not configured for this connection.");
  }
  const repositories = await listInstallationRepositoriesWithToken(access.token);

  return {
    accountLogin: connection.account_login,
    authSource: "github_app",
    expiresAt: access.expiresAt,
    permissions: access.permissions,
    repositorySelection: access.repositorySelection,
    repositoryCount: repositories.length
  };
}

async function listInstallationRepositoriesWithToken(token: string): Promise<GitHubInstallationRepository[]> {
  const repositories: GitHubInstallationRepository[] = [];
  let page = 1;
  while (page <= 10) {
    const payload = await githubInstallationRequest<{
      repositories?: Array<{
        id?: number;
        full_name?: string;
        html_url?: string;
        private?: boolean;
        default_branch?: string | null;
      }>;
    }>(`/installation/repositories?per_page=100&page=${page}`, token);
    const rows = Array.isArray(payload.repositories) ? payload.repositories : [];
    for (const row of rows) {
      if (!row.full_name || !row.html_url || typeof row.id !== "number") {
        continue;
      }
      repositories.push({
        id: row.id,
        fullName: row.full_name,
        htmlUrl: row.html_url,
        private: Boolean(row.private),
        defaultBranch: row.default_branch
      });
    }
    if (rows.length < 100) {
      break;
    }
    page += 1;
  }
  return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function listUserRepositoriesWithToken(token: string): Promise<GitHubInstallationRepository[]> {
  const repositories: GitHubInstallationRepository[] = [];
  let page = 1;
  while (page <= 10) {
    const rows = await githubUserRequest<
      Array<{
        id?: number;
        full_name?: string;
        html_url?: string;
        private?: boolean;
        default_branch?: string | null;
      }>
    >(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, token);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row.full_name || !row.html_url || typeof row.id !== "number") {
        continue;
      }
      repositories.push({
        id: row.id,
        fullName: row.full_name,
        htmlUrl: row.html_url,
        private: Boolean(row.private),
        defaultBranch: row.default_branch
      });
    }
    if (!Array.isArray(rows) || rows.length < 100) {
      break;
    }
    page += 1;
  }
  return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function githubAppRequest<T>(
  path: string,
  init: { method?: "GET" | "POST" } = {},
  env: Env = process.env
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${createGitHubAppJwt(env)}`,
      "User-Agent": "Forge GitHub App"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubAppRequestError(
      `GitHub App request failed for ${path}: ${response.status} ${body.slice(0, 300)}`,
      response.status,
      path
    );
  }

  return (await response.json()) as T;
}

async function githubInstallationRequest<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Forge GitHub App"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubAppRequestError(
      `GitHub installation request failed for ${path}: ${response.status} ${body.slice(0, 300)}`,
      response.status,
      path
    );
  }

  return (await response.json()) as T;
}

async function githubUserRequest<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Forge GitHub App"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubAppRequestError(
      `GitHub user request failed for ${path}: ${response.status} ${body.slice(0, 300)}`,
      response.status,
      path
    );
  }

  return (await response.json()) as T;
}

function createGitHubAppJwt(env: Env = process.env): string {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App access.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

function base64Url(value: string | Buffer): string {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): Buffer | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "="), "base64");
  } catch {
    return null;
  }
}

function githubCallbackStateSecret(env: Env = process.env): string | undefined {
  return env.GITHUB_STATE_SECRET?.trim() || env.GITHUB_WEBHOOK_SECRET?.trim() || undefined;
}

function requiresSignedGitHubState(env: Env = process.env): boolean {
  return ["1", "true", "yes"].includes((env.FORGE_REQUIRE_AUTH || "").toLowerCase());
}

function githubCallbackStateExpired(issuedAt: unknown, env: Env = process.env): boolean {
  if (typeof issuedAt !== "string" || !issuedAt.trim()) {
    return true;
  }
  const issuedAtMs = new Date(issuedAt).getTime();
  if (Number.isNaN(issuedAtMs)) {
    return true;
  }
  const maxAgeSeconds = Number(env.GITHUB_STATE_MAX_AGE_SECONDS || 15 * 60);
  const maxAgeMs = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds * 1000 : 15 * 60 * 1000;
  const ageMs = Date.now() - issuedAtMs;
  return ageMs < -60 * 1000 || ageMs > maxAgeMs;
}

function gitHubOAuthClientId(env: Env = process.env): string | undefined {
  return env.GITHUB_APP_CLIENT_ID || env.GITHUB_CLIENT_ID;
}

function gitHubOAuthClientSecret(): string | undefined {
  return process.env.GITHUB_APP_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET;
}

function secondsFromNow(seconds: unknown): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null;
}

function splitScopes(scope: unknown): string[] {
  return typeof scope === "string" && scope.trim()
    ? scope.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)
    : [];
}

function tokenExpiresSoon(value?: string | null): boolean {
  if (!value) return false;
  const expiresAt = new Date(value).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - Date.now() < 2 * 60 * 1000;
}
