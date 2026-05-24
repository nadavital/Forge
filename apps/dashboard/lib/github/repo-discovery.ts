import type { DbEvaluation, DbOpportunity, DbSignal, JsonObject } from "@/lib/db/types";
import { runAntigravityRepoAnalysis } from "@/lib/github/repo-analysis-agent";

type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  default_branch?: string;
  topics?: string[];
  stargazers_count?: number;
  open_issues_count?: number;
  pushed_at?: string;
};

type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  comments: number;
  labels: Array<{ name?: string }>;
  pull_request?: unknown;
  updated_at?: string;
};

type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
};

export type RepoDiscoveryResult = {
  repoUrl: string;
  projectName: string;
  productContext: string;
  knowledge: JsonObject;
  analysis: JsonObject;
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
  opportunities: Array<
    Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
      signalIndexes: number[];
      evaluations: Array<Omit<DbEvaluation, "id" | "opportunity_id">>;
    }
  >;
};

const ISSUE_LIMIT = 30;

export async function discoverGitHubRepo(repoUrl: string): Promise<RepoDiscoveryResult> {
  const repoRef = parseGitHubRepo(repoUrl);
  const [repo, readme, issues] = await Promise.all([
    fetchGitHub<GitHubRepo>(`/repos/${repoRef.owner}/${repoRef.name}`),
    fetchReadme(repoRef.owner, repoRef.name),
    fetchIssues(repoRef.owner, repoRef.name)
  ]);
  const tree = await fetchRepoTree(repoRef.owner, repoRef.name, repo.default_branch);

  const productText = compact([repo.description, readme].filter(Boolean).join("\n\n"), 2200);
  const issueSignals = issues
    .filter((issue) => !issue.pull_request)
    .slice(0, ISSUE_LIMIT)
    .map((issue) => ({
      source: "github",
      title: `#${issue.number} ${issue.title}`,
      body: compact(
        [
          issue.body,
          issue.labels?.map((label) => label.name).filter(Boolean).join(", "),
          `${issue.state}, ${issue.comments} comments`
        ]
          .filter(Boolean)
          .join("\n"),
        900
      ),
      url: issue.html_url
    }));

  const signals: Array<Omit<DbSignal, "id" | "project_id">> = [
    {
      source: "github_repo",
      title: repo.description || `${repo.full_name} repository context`,
      body: compact(
        [
          `Repository: ${repo.full_name}`,
          repo.description ? `Description: ${repo.description}` : "",
          repo.language ? `Primary language: ${repo.language}` : "",
          repo.topics?.length ? `Topics: ${repo.topics.join(", ")}` : "",
          tree.length ? `Observed files: ${tree.slice(0, 80).map((entry) => entry.path).join(", ")}` : "",
          readme ? `README: ${compact(readme, 1000)}` : ""
        ]
          .filter(Boolean)
          .join("\n"),
        1600
      ),
      url: repo.html_url
    },
    ...issueSignals
  ];

  const repoScan = buildRepoScan(repo, issues, tree);
  const semanticDiscovery = await runAntigravityRepoAnalysis({
    repoUrl: repo.html_url,
    repoName: repo.full_name,
    productContext: productText || repo.description || repo.full_name,
    signals,
    repoScan
  });

  return {
    repoUrl: repo.html_url,
    projectName: repo.full_name,
    productContext: productText || repo.description || repo.full_name,
    knowledge: semanticDiscovery.knowledge,
    analysis: semanticDiscovery.metadata,
    signals,
    opportunities: semanticDiscovery.opportunities
  };
}

function buildRepoScan(
  repo: GitHubRepo,
  issues: GitHubIssue[],
  tree: GitHubTreeEntry[]
): JsonObject {
  const files = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const activeIssues = actionableIssues(issues).slice(0, 5);

  return {
    repo: repo.full_name,
    repo_url: repo.html_url,
    language: repo.language,
    default_branch: repo.default_branch,
    topics: repo.topics ?? [],
    files_seen: files.length,
    issues_seen: issues.filter((issue) => !issue.pull_request).length,
    actionable_issues: activeIssues.length,
    representative_files: files.slice(0, 120),
    recent_repo_signals: activeIssues.map((issue) => ({
      issue_number: issue.number,
      title: issue.title,
      url: issue.html_url
    }))
  };
}

function actionableIssues(issues: GitHubIssue[]): GitHubIssue[] {
  return issues
    .filter((issue) => !issue.pull_request)
    .filter((issue) => {
      const body = issue.body?.trim() ?? "";
      const labels = issue.labels?.map((label) => label.name).filter(Boolean) ?? [];
      return body.length >= 80 || labels.length > 0 || issue.comments > 0;
    })
    .sort((a, b) => issueEvidenceScore(b) - issueEvidenceScore(a));
}

function issueEvidenceScore(issue: GitHubIssue): number {
  return (issue.body?.trim().length ?? 0) / 120 + (issue.labels?.length ?? 0) * 2 + issue.comments * 3;
}

async function fetchReadme(owner: string, name: string): Promise<string> {
  try {
    const payload = await fetchGitHub<{ content?: string; encoding?: string }>(`/repos/${owner}/${name}/readme`);
    if (payload.encoding === "base64" && payload.content) {
      return Buffer.from(payload.content, "base64").toString("utf8");
    }
  } catch {
    return "";
  }
  return "";
}

async function fetchIssues(owner: string, name: string): Promise<GitHubIssue[]> {
  try {
    return await fetchGitHub<GitHubIssue[]>(`/repos/${owner}/${name}/issues?state=all&per_page=${ISSUE_LIMIT}&sort=updated`);
  } catch {
    return [];
  }
}

async function fetchRepoTree(owner: string, name: string, branch = "main"): Promise<GitHubTreeEntry[]> {
  try {
    const payload = await fetchGitHub<{ tree?: GitHubTreeEntry[] }>(
      `/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    return Array.isArray(payload.tree) ? payload.tree.slice(0, 500) : [];
  } catch {
    return [];
  }
}

async function fetchGitHub<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Forge demo repo discovery",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub request failed for ${path}: ${response.status} ${body.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

function parseGitHubRepo(repoUrl: string): { owner: string; name: string } {
  const trimmed = repoUrl.trim();
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    return { owner: shorthand[1], name: shorthand[2].replace(/\.git$/, "") };
  }

  const url = new URL(trimmed.replace(/^git@github\.com:/, "https://github.com/"));
  if (url.hostname !== "github.com") {
    throw new Error("Only GitHub repository URLs are supported for this demo.");
  }
  const [owner, repo] = url.pathname.replace(/^\/|\/$/g, "").split("/");
  if (!owner || !repo) {
    throw new Error("GitHub repository URL must include owner and repo.");
  }
  return { owner, name: repo.replace(/\.git$/, "") };
}

function compact(value: string, limit = 700): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}
