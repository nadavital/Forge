import type { BuildBrief } from "@/lib/build/brief";
import type { DbGitHubConnection } from "../db/types.ts";
import { generatedRepoConnectionCanCreate, githubConnectionCanWriteContents } from "./github-target.ts";
import { installationTokenForConnection, userAccessTokenForConnection } from "../github/github-app.ts";
import { githubTokenFallbackEnabled, githubTokenFromEnv } from "../github/token-fallback.ts";

type BuilderFile = {
  path?: string;
  content?: string | null;
};

export type GitHubPrResult = {
  generatedRepoUrl: string;
  branch: string;
  prUrl: string;
};

type RepoRef = {
  owner: string;
  repo: string;
};

type GitHubAccess = {
  token: string;
  source: "github_app" | "github_user" | "env";
  connection?: DbGitHubConnection;
};

export async function createGitHubPrFromFiles(input: {
  brief: BuildBrief;
  files: BuilderFile[];
  githubConnection?: DbGitHubConnection;
}): Promise<GitHubPrResult> {
  const access = await resolveGitHubAccessForBuildTarget(input);
  if (!access) {
    throw new Error(
      input.brief.build_target.kind === "existing_repo_pr"
        ? "A project-linked GitHub App installation token is required to create an existing-repo PR. Set FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 only for local dev fallback."
        : input.brief.build_target.github_connection_id
          ? "A GitHub App installation token or GitHub user OAuth token is required to create or update the generated repository target. Set FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 only for local dev fallback."
          : "A GitHub connection or explicit local dev token fallback is required to create a generated repository PR."
    );
  }

  const files = normalizeFiles(input.files, input.brief);
  if (files.length === 0) {
    throw new Error("Managed builder returned no files to commit.");
  }

  const repo =
    input.brief.build_target.kind === "generated_repo_with_pr"
      ? await ensureGeneratedRepo({ brief: input.brief, access })
      : repoRefFromUrl(input.brief.build_target.target_repo_url);
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  const defaultBranch = await getDefaultBranch({ repo, token: access.token });
  const branch = await createBranch({ repo, token: access.token, baseBranch: defaultBranch, branch: input.brief.build_target.branch_name });

  for (const file of files) {
    await upsertFile({
      repo,
      token: access.token,
      branch,
      path: file.path,
      content: file.content
    });
  }

  const pr = await githubFetch<{ html_url: string }>(
    `/repos/${repo.owner}/${repo.repo}/pulls`,
    access.token,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.brief.build_target.pr_title,
        head: branch,
        base: defaultBranch,
        body: prBody(input.brief)
      })
    }
  );

  return {
    generatedRepoUrl: repoUrl,
    branch,
    prUrl: pr.html_url
  };
}

export async function resolveGitHubTokenForBuildTarget(input: {
  brief: BuildBrief;
  githubConnection?: DbGitHubConnection;
}): Promise<string | null> {
  return (await resolveGitHubAccessForBuildTarget(input))?.token ?? null;
}

export async function resolveGitHubAccessForBuildTarget(input: {
  brief: BuildBrief;
  githubConnection?: DbGitHubConnection;
}): Promise<GitHubAccess | null> {
  if (input.brief.build_target.kind === "existing_repo_pr") {
    if (input.githubConnection?.provider === "github_app" && githubConnectionCanWriteContents(input.githubConnection)) {
      const app = await appAccess(input.githubConnection);
      if (app) {
        return app;
      }
    }
    return envAccess();
  }
  if (input.brief.build_target.github_connection_id) {
    if (
      githubConnectionCanWriteContents(input.githubConnection) &&
      canUseAppAccessForGeneratedRepo(input.brief, input.githubConnection)
    ) {
      const app = await appAccess(input.githubConnection);
      if (!app) {
        return (await userAccess(input.githubConnection)) ?? envAccess();
      }
      return app;
    }
    const user = await userAccess(input.githubConnection);
    if (user) {
      return user;
    }
    return envAccess();
  }
  return envAccess();
}

async function appAccess(connection?: DbGitHubConnection): Promise<GitHubAccess | null> {
  const token = await installationTokenForConnection(connection);
  return token ? { token, source: "github_app", connection } : null;
}

async function userAccess(connection?: DbGitHubConnection): Promise<GitHubAccess | null> {
  if (connection?.provider !== "github_oauth") {
    return null;
  }
  const token = await userAccessTokenForConnection(connection);
  return token ? { token, source: "github_user", connection } : null;
}

function canUseAppAccessForGeneratedRepo(brief: BuildBrief, connection?: DbGitHubConnection): boolean {
  if (!connection) return false;
  if (!brief.build_target.create_repo_if_missing) return true;
  return (
    connection.account_login === brief.build_target.generated_repo_owner &&
    generatedRepoConnectionCanCreate(connection)
  );
}

function envAccess(): GitHubAccess | null {
  if (!githubTokenFallbackEnabled()) return null;
  const token = githubTokenFromEnv();
  return token ? { token, source: "env" } : null;
}

async function ensureGeneratedRepo(input: { brief: BuildBrief; access: GitHubAccess }): Promise<RepoRef> {
  const owner = input.brief.build_target.generated_repo_owner;
  const repo = input.brief.build_target.generated_repo_name;
  const existing = await maybeGithubFetch<unknown>(`/repos/${owner}/${repo}`, input.access.token);
  if (existing.ok) return { owner, repo };
  if (!input.brief.build_target.create_repo_if_missing) {
    throw new Error(
      `Generated repository target ${owner}/${repo} does not exist or is not visible to the configured GitHub connection. Pre-create it, connect an organization installation that can create repos, or authorize GitHub user OAuth for user-owned generated repos.`
    );
  }

  const path = generatedRepoCreatePath({ owner, access: input.access });
  await githubFetch(path, input.access.token, {
    method: "POST",
    body: JSON.stringify({
      name: repo,
      private: false,
      auto_init: true,
      description: `Forge generated MVP for ${input.brief.title}`
    })
  });
  return { owner, repo };
}

function generatedRepoCreatePath(input: { owner: string; access: GitHubAccess }): string {
  if (input.access.source === "github_app") {
    const connection = input.access.connection;
    if (connection?.account_type !== "Organization" || connection.account_login !== input.owner) {
      throw new Error(
        "GitHub App installation tokens can create generated repositories only for the installed organization account. Use a generated-repo org installation, a pre-created repo target, or configure GitHub user OAuth for user accounts."
      );
    }
    return `/orgs/${input.owner}/repos`;
  }
  if (input.access.source === "github_user" && input.access.connection?.account_login !== input.owner) {
    throw new Error(
      "GitHub user OAuth can create generated repositories only for the authorized user account. Choose the matching generated-repo target or use an organization installation."
    );
  }
  return "/user/repos";
}

async function getDefaultBranch(input: { repo: RepoRef; token: string }): Promise<string> {
  const repo = await githubFetch<{ default_branch?: string }>(`/repos/${input.repo.owner}/${input.repo.repo}`, input.token);
  return repo.default_branch || "main";
}

async function createBranch(input: {
  repo: RepoRef;
  token: string;
  baseBranch: string;
  branch: string;
}): Promise<string> {
  const base = await githubFetch<{ object: { sha: string } }>(
    `/repos/${input.repo.owner}/${input.repo.repo}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
    input.token
  );
  const uniqueBranch = `${input.branch}-${Date.now().toString(36)}`;
  await githubFetch(`/repos/${input.repo.owner}/${input.repo.repo}/git/refs`, input.token, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${uniqueBranch}`,
      sha: base.object.sha
    })
  });
  return uniqueBranch;
}

async function upsertFile(input: {
  repo: RepoRef;
  token: string;
  branch: string;
  path: string;
  content: string;
}): Promise<void> {
  const existing = await maybeGithubFetch<{ sha?: string }>(
    `/repos/${input.repo.owner}/${input.repo.repo}/contents/${encodeURIComponentPath(input.path)}?ref=${encodeURIComponent(input.branch)}`,
    input.token
  );
  const body: Record<string, unknown> = {
    message: `Forge: add ${input.path}`,
    branch: input.branch,
    content: Buffer.from(input.content, "utf8").toString("base64")
  };
  if (existing.ok && existing.value.sha) body.sha = existing.value.sha;

  await githubFetch(`/repos/${input.repo.owner}/${input.repo.repo}/contents/${encodeURIComponentPath(input.path)}`, input.token, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

function normalizeFiles(files: BuilderFile[], brief: BuildBrief): Array<{ path: string; content: string }> {
  const normalized = files
    .filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
    .map((file) => ({
      path: scopedPath(cleanPath(file.path || ""), brief),
      content: file.content || ""
    }))
    .filter((file) => file.path && file.content);

  const hasReadme = normalized.some((file) => file.path.toLowerCase() === "readme.md");
  if (!hasReadme) {
    normalized.unshift({
      path: scopedPath("README.md", brief),
      content: `# ${brief.title}\n\n${brief.mvp_concept}\n\n## Run\n\nFollow the app-specific instructions in this PR.\n\n## Services\n\nFree services only. No production deployment is configured.\n`
    });
  }
  return normalized;
}

function scopedPath(path: string, brief: BuildBrief): string {
  if (!path || brief.build_target.kind !== "existing_repo_pr") return path;
  if (path.startsWith("forge-mvp/")) return path;
  return `forge-mvp/${slugify(brief.title)}/${path}`;
}

function repoRefFromUrl(repoUrl: string): RepoRef {
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.#?]+)(?:\.git)?/i);
  if (!match) throw new Error(`Unsupported GitHub repo URL: ${repoUrl}`);
  return { owner: match[1], repo: match[2] };
}

function prBody(brief: BuildBrief): string {
  return [
    `Generated by Forge ManagedBuilder for **${brief.title}**.`,
    "",
    `Problem: ${brief.problem}`,
    "",
    `MVP: ${brief.mvp_concept}`,
    "",
    "Contract:",
    "- Runnable app code",
    "- README with setup and run instructions",
    "- Basic smoke checks",
    "- Free services only; no production deploy"
  ].join("\n");
}

async function maybeGithubFetch<T>(path: string, token: string): Promise<{ ok: true; value: T } | { ok: false }> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(token)
  });
  if (!response.ok) return { ok: false };
  return { ok: true, value: (await response.json()) as T };
}

async function githubFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...githubHeaders(token),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function cleanPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\.\.(\/|$)/g, "").trim();
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mvp";
}
