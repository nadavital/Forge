import { normalizeGithubRepository } from "@/lib/project-onboarding";

export async function ensureProjectGitHubRepo(input: {
  projectName: string;
  repoUrl?: string | null;
  description?: string | null;
}): Promise<string> {
  const normalized = normalizeGithubRepository(input.repoUrl);
  if (normalized) {
    return normalized.repoUrl;
  }

  return createGitHubRepo({
    name: repoNameFromProject(input.projectName),
    description: input.description
  });
}

async function createGitHubRepo(input: { name: string; description?: string | null }): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to create a repository for new Forge projects.");
  }

  const owner = clean(process.env.FORGE_GENERATED_REPO_OWNER) || clean(process.env.FORGE_GITHUB_OWNER);
  const existing = owner ? await findRepo(token, owner, input.name) : null;
  if (existing) {
    return existing;
  }

  const response = await fetch(owner ? `https://api.github.com/orgs/${owner}/repos` : "https://api.github.com/user/repos", {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      name: input.name,
      description: clean(input.description) || "Created by Forge for autonomous product discovery.",
      private: true,
      auto_init: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub repository creation failed: ${response.status} ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as { html_url?: string };
  if (!payload.html_url) {
    throw new Error("GitHub repository creation succeeded but did not return html_url.");
  }
  return payload.html_url;
}

async function findRepo(token: string, owner: string, repo: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: githubHeaders(token)
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub repository lookup failed: ${response.status} ${body.slice(0, 300)}`);
  }
  const payload = (await response.json()) as { html_url?: string };
  return payload.html_url ?? null;
}

function repoNameFromProject(projectName: string): string {
  const base = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || `forge-project-${Date.now()}`;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Forge project onboarding"
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
