import type { DbEvaluation, DbOpportunity, DbSignal, JsonObject } from "@/lib/db/types";

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

  const opportunities = synthesizeRepoOpportunities({
    repo,
    readme,
    issues,
    tree,
    signals
  });

  return {
    repoUrl: repo.html_url,
    projectName: repo.full_name,
    productContext: productText || repo.description || repo.full_name,
    knowledge: buildProjectKnowledge(repo, readme, issues, tree),
    signals,
    opportunities
  };
}

function buildProjectKnowledge(
  repo: GitHubRepo,
  readme: string,
  issues: GitHubIssue[],
  tree: GitHubTreeEntry[]
): JsonObject {
  const files = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const surfaces = detectRepoSurfaces(files, readme);
  const frameworks = detectFrameworks(files, readme);
  const workflows = surfaces.map((surface) => surface.label);
  const activeIssues = actionableIssues(issues).slice(0, 5);

  return {
    repo: repo.full_name,
    repo_url: repo.html_url,
    description: repo.description,
    primary_language: repo.language,
    topics: repo.topics ?? [],
    semantic_summary: summarizeProject(repo, readme, frameworks, workflows),
    frameworks,
    app_surfaces: surfaces.slice(0, 8).map((surface) => ({
      id: surface.id,
      label: surface.label,
      evidence_files: surface.files.slice(0, 10)
    })),
    product_workflows: workflows.slice(0, 8),
    evidence_counts: {
      files_seen: files.length,
      issues_seen: issues.filter((issue) => !issue.pull_request).length,
      actionable_issues: activeIssues.length,
      surfaces_detected: surfaces.length
    },
    recent_repo_signals: activeIssues.map((issue) => ({
      issue_number: issue.number,
      title: issue.title,
      url: issue.html_url
    })),
    updated_at: new Date().toISOString()
  };
}

function summarizeProject(
  repo: GitHubRepo,
  readme: string,
  frameworks: string[],
  workflows: string[]
): string {
  const readmeLine = readmeEvidenceLine(readme);
  const frameworkLine = frameworks.length > 0 ? `${frameworks.slice(0, 3).join(", ")} app` : "software project";
  const workflowLine = workflows.length > 0 ? ` with ${workflows.slice(0, 3).join(", ")} surfaces` : "";
  return compact(`${repo.full_name} appears to be a ${frameworkLine}${workflowLine}. ${readmeLine || repo.description || ""}`, 360);
}

function detectFrameworks(files: string[], readme: string): string[] {
  const evidence = `${files.join("\n")}\n${readme}`.toLowerCase();
  const frameworks: Array<[string, string[]]> = [
    ["SwiftUI", ["swiftui", ".xcodeproj", "package.swift"]],
    ["iOS", ["ios", ".xcodeproj", "appdelegate", "scenedelegate", "widget"]],
    ["Next.js", ["next.config", "app/page.tsx", "pages/", "next dev"]],
    ["React", ["react", "jsx", "tsx", "vite.config"]],
    ["Python", ["requirements.txt", "pyproject.toml", ".py"]],
    ["Supabase", ["supabase", "postgres", "rls"]]
  ];

  return frameworks
    .filter(([, terms]) => terms.some((term) => evidence.includes(term)))
    .map(([name]) => name);
}

function synthesizeRepoOpportunities(input: {
  repo: GitHubRepo;
  readme: string;
  issues: GitHubIssue[];
  tree: GitHubTreeEntry[];
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
}): RepoDiscoveryResult["opportunities"] {
  const repoSignalIndex = 0;
  const issueIndexes = input.signals.map((_, index) => index).slice(1);
  const opportunities = actionableIssues(input.issues)
    .slice(0, 4)
    .map((issue) => {
      const signalIndex = issueIndexes.find((index) => input.signals[index]?.url === issue.html_url);
      return issueDerivedOpportunity(input.repo, issue, [
        repoSignalIndex,
        ...(signalIndex ? [signalIndex] : [])
      ]);
    });

  if (opportunities.length === 0) {
    opportunities.push(...repoSurfaceOpportunities(input.repo, input.readme, input.tree, repoSignalIndex));
  }

  return dedupeOpportunities(opportunities)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, 4);
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

function issueDerivedOpportunity(
  repo: GitHubRepo,
  issue: GitHubIssue,
  signalIndexes: number[]
): RepoDiscoveryResult["opportunities"][number] {
  const labels = issue.labels?.map((label) => label.name).filter(Boolean) ?? [];
  const evidenceSummary = compact(issue.body?.trim() || issue.title, 360);
  const labelSummary = labels.length > 0 ? ` Labels: ${labels.join(", ")}.` : "";
  const commentSummary = issue.comments > 0 ? ` ${issue.comments} comment${issue.comments === 1 ? "" : "s"} on the issue.` : "";

  return makeOpportunity({
    title: `Address #${issue.number}: ${compact(issue.title, 82)}`,
    problem: `${repo.name} has a concrete repo signal in issue #${issue.number}: ${evidenceSummary}${labelSummary}${commentSummary}`,
    targetUser: "Developers and maintainers working with this repository",
    mvpConcept: `Implement the smallest reviewable change that resolves or materially advances issue #${issue.number}: ${compact(issue.title, 120)}.`,
    score: Math.min(90, 64 + Math.round(issueEvidenceScore(issue))),
    rationale: `Created from GitHub issue #${issue.number}, not from a generic repository template.`,
    signalIndexes,
    profile: {
      origin: "github_issue",
      repo: repo.full_name,
      issue_number: issue.number,
      issue_url: issue.html_url,
      labels
    }
  });
}

function repoSurfaceOpportunities(
  repo: GitHubRepo,
  readme: string,
  tree: GitHubTreeEntry[],
  repoSignalIndex: number
): RepoDiscoveryResult["opportunities"] {
  const files = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const surfaces = detectRepoSurfaces(files, readme);
  const readmeEvidence = readmeEvidenceLine(readme);

  return surfaces.slice(0, 3).map((surface) =>
    makeOpportunity({
      title: `${surface.title} in ${repo.name}`,
      problem: `${repo.name} has an active ${surface.label} workflow that looks important to the user experience.${readmeEvidence ? ` README context: ${readmeEvidence}` : ""}`,
      targetUser: surface.targetUser,
      mvpConcept: surface.mvpConcept(repo.name),
      score: surface.score,
      rationale: surface.rationale(),
      signalIndexes: [repoSignalIndex],
      profile: {
        origin: "repo_surface",
        repo: repo.full_name,
        surface: surface.id,
        evidence_files: surface.files.slice(0, 12)
      }
    })
  );
}

function detectRepoSurfaces(files: string[], readme: string) {
  const text = `${files.join("\n")}\n${readme}`.toLowerCase();
  const candidates = [
    {
      id: "onboarding",
      label: "onboarding and first-run",
      title: "Improve first-run activation",
      terms: ["onboarding", "signup", "login", "auth", "welcome", "tutorial", "firstlaunch", "paywall"],
      targetUser: "New users opening the app for the first time",
      mvpConcept: (repoName: string) =>
        `Add a reviewable first-run improvement for ${repoName}: clearer setup state, progress feedback, or a guided empty-state path using the existing onboarding files.`,
      rationale: () => "The repo contains onboarding/auth surfaces, so the next useful improvement is likely reducing first-run friction.",
      score: 84
    },
    {
      id: "planning",
      label: "planning and generation",
      title: "Make generated plans easier to trust",
      terms: ["plan", "planner", "generate", "gemini", "ai", "recommendation", "schedule", "routine"],
      targetUser: "Users relying on generated app recommendations or plans",
      mvpConcept: (repoName: string) =>
        `Add transparency around one generated ${repoName} workflow: show why the result was created, what inputs affected it, and how to regenerate or adjust it.`,
      rationale: () => "The app appears to generate plans or recommendations, so trust and editability are high-leverage product improvements.",
      score: 86
    },
    {
      id: "tracking",
      label: "tracking and progress",
      title: "Strengthen progress feedback",
      terms: ["progress", "history", "stats", "analytics", "tracker", "tracking", "streak", "chart"],
      targetUser: "Returning users checking whether the product is helping them improve",
      mvpConcept: (repoName: string) =>
        `Build a small progress review surface in ${repoName} using existing tracked data, with one clear trend and one suggested next action.`,
      rationale: () => "The repo contains progress/history surfaces, so Forge can improve the returning-user feedback loop.",
      score: 82
    },
    {
      id: "workout",
      label: "workout and activity",
      title: "Tighten the live activity loop",
      terms: ["workout", "exercise", "activity", "timer", "set", "rep", "muscle", "training"],
      targetUser: "Users actively logging or following activity inside the app",
      mvpConcept: (repoName: string) =>
        `Improve one active-use ${repoName} flow so the user can see current state, next step, and completion outcome without leaving the main activity screen.`,
      rationale: () => "The repo has a live workout/activity workflow, which is a good candidate for a focused usability improvement.",
      score: 88
    },
    {
      id: "nutrition",
      label: "nutrition and logging",
      title: "Clarify food logging outcomes",
      terms: ["food", "meal", "nutrition", "calorie", "macro", "protein", "carb", "fat"],
      targetUser: "Users logging nutrition or reviewing meal decisions",
      mvpConcept: (repoName: string) =>
        `Improve a nutrition logging or review flow in ${repoName} with clearer post-log feedback and one practical next suggestion.`,
      rationale: () => "The repo has nutrition logging surfaces, so the opportunity is to make post-log feedback more immediately useful.",
      score: 85
    },
    {
      id: "widgets",
      label: "widget and shortcut",
      title: "Expose the fastest return path",
      terms: ["widget", "shortcut", "intent", "liveactivity", "notification", "deeplink"],
      targetUser: "Returning users who need fast access outside the main app",
      mvpConcept: (repoName: string) =>
        `Add or improve one ${repoName} shortcut/widget return path that lands users directly in the relevant active workflow.`,
      rationale: () => "The repo includes widgets, intents, or shortcuts, so Forge can improve the fastest return path for repeat use.",
      score: 80
    }
  ];

  return candidates
    .map((candidate) => {
      const matchedFiles = files.filter((file) => includesAny(file, candidate.terms));
      const readmeHits = candidate.terms.filter((term) => text.includes(term));
      return {
        ...candidate,
        files: matchedFiles,
        evidenceScore: matchedFiles.length * 3 + readmeHits.length
      };
    })
    .filter((candidate) => candidate.evidenceScore >= 3 && candidate.files.length > 0)
    .sort((a, b) => b.evidenceScore - a.evidenceScore);
}

function readmeEvidenceLine(readme: string): string {
  const line = readme
    .split(/\n+/)
    .map((entry) => entry.replace(/^#+\s*/, "").trim())
    .find((entry) => entry.length >= 40 && entry.length <= 220);
  return line ? compact(line, 180) : "";
}

function includesAny(text: string, terms: string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

function makeOpportunity(input: {
  title: string;
  problem: string;
  targetUser: string;
  mvpConcept: string;
  score: number;
  rationale: string;
  signalIndexes: number[];
  profile: JsonObject;
}): RepoDiscoveryResult["opportunities"][number] {
  return {
    title: input.title,
    problem: input.problem,
    target_user: input.targetUser,
    mvp_concept: input.mvpConcept,
    score: input.score,
    score_rationale: input.rationale,
    status: "proposed",
    profile: input.profile,
    signalIndexes: input.signalIndexes,
    evaluations: [
      {
        evaluator: "taste_critic",
        content: "Repo-derived evidence: the MVP is tied to a concrete GitHub issue and avoids paid or production dependencies.",
        scores: { usefulness: 0.82, coherence: 0.84, differentiation: 0.72 }
      },
      {
        evaluator: "bull",
        content: "The linked issue supplies enough context to create a concrete workflow improvement instead of a generic example.",
        scores: {}
      },
      {
        evaluator: "bear",
        content: "Issue volume may be thin, so the first demo should treat this as a prototype direction rather than market proof.",
        scores: {}
      },
      {
        evaluator: "decision_agent",
        content: input.rationale,
        scores: { recommendation: "prototype", confidence: Math.min(0.9, Number(input.score) / 100) }
      }
    ]
  };
}

function dedupeOpportunities<T extends { title?: string | null }>(opportunities: T[]): T[] {
  const seen = new Set<string>();
  return opportunities.filter((opportunity) => {
    const key = (opportunity.title || "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
