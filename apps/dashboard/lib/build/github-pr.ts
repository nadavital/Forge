import type { BuildBrief } from "@/lib/build/brief";

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

export async function createGitHubPrFromFiles(input: {
  brief: BuildBrief;
  files: BuilderFile[];
}): Promise<GitHubPrResult> {
  const token = process.env.FORGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN or FORGE_GITHUB_TOKEN is required to create a GitHub PR from managed builder files.");
  }

  const files = normalizeFiles(input.files, input.brief);
  if (files.length === 0) {
    throw new Error("Managed builder returned no files to commit.");
  }

  const repo =
    input.brief.build_target.kind === "generated_repo_with_pr"
      ? await ensureGeneratedRepo({ brief: input.brief, token })
      : repoRefFromUrl(input.brief.build_target.target_repo_url);
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  const defaultBranch = await getDefaultBranch({ repo, token });
  const branch = await createBranch({ repo, token, baseBranch: defaultBranch, branch: input.brief.build_target.branch_name });

  for (const file of files) {
    await upsertFile({
      repo,
      token,
      branch,
      path: file.path,
      content: file.content
    });
  }

  const pr = await githubFetch<{ html_url: string }>(
    `/repos/${repo.owner}/${repo.repo}/pulls`,
    token,
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

async function ensureGeneratedRepo(input: { brief: BuildBrief; token: string }): Promise<RepoRef> {
  const owner = input.brief.build_target.generated_repo_owner;
  const repo = input.brief.build_target.generated_repo_name;
  const existing = await maybeGithubFetch<unknown>(`/repos/${owner}/${repo}`, input.token);
  if (existing.ok) return { owner, repo };

  const user = await githubFetch<{ login: string }>(`/user`, input.token);
  const path = owner === user.login ? "/user/repos" : `/orgs/${owner}/repos`;
  await githubFetch(path, input.token, {
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
