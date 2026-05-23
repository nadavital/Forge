import type { DbEvaluation, DbOpportunity, DbSignal, JsonObject } from "@/lib/db/types";

type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
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

export type RepoDiscoveryResult = {
  repoUrl: string;
  projectName: string;
  productContext: string;
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
    signals
  });

  return {
    repoUrl: repo.html_url,
    projectName: repo.full_name,
    productContext: productText || repo.description || repo.full_name,
    signals,
    opportunities
  };
}

function synthesizeRepoOpportunities(input: {
  repo: GitHubRepo;
  readme: string;
  issues: GitHubIssue[];
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
}): RepoDiscoveryResult["opportunities"] {
  const text = `${input.repo.description ?? ""}\n${input.readme}\n${input.issues
    .map((issue) => `${issue.title}\n${issue.body ?? ""}\n${issue.labels?.map((label) => label.name).join(" ")}`)
    .join("\n")}`.toLowerCase();
  const repoSignalIndex = 0;
  const issueIndexes = input.signals.map((_, index) => index).slice(1);
  const domain = inferDomain(text, input.repo);
  const opportunities = domainOpportunities(domain, input.repo, repoSignalIndex);

  const categories = scoreCategories(text, input.issues);
  for (const category of categories.slice(0, 2)) {
    const linkedIssues = issueIndexes.filter((index) => category.matches(input.signals[index]));
    const signalIndexes = [repoSignalIndex, ...linkedIssues].slice(0, 5);
    opportunities.push(makeOpportunity({
      title: `${category.label} for ${input.repo.name}`,
      problem: category.problem(input.repo.name),
      targetUser: category.targetUser(),
      mvpConcept: category.mvp(),
      score: Math.min(92, 70 + category.score * 4 + linkedIssues.length * 3),
      rationale: `${category.score} repo signals matched ${category.label.toLowerCase()} language.`,
      signalIndexes,
      profile: {
        domain,
        category: category.id,
        observed_terms: category.terms
      }
    }));
  }

  return dedupeOpportunities(opportunities)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, 4);
}

function domainOpportunities(domain: string, repo: GitHubRepo, repoSignalIndex: number): RepoDiscoveryResult["opportunities"] {
  if (domain === "robotics") {
    return [
      makeOpportunity({
        title: "Mission replay and uncertainty inspector",
        problem: "Robotics builders need to see why an autonomous exploration run chose a path before trusting it outside simulation.",
        targetUser: "Robotics researchers and autonomy engineers",
        mvpConcept:
          "Upload or load a simulation run, replay the trajectory, and overlay map coverage, frontier choices, and uncertainty hotspots.",
        score: 95,
        rationale: "The repository is centered on autonomous exploration, active mapping, and uncertainty-aware planning.",
        signalIndexes: [repoSignalIndex],
        profile: { domain, repo: repo.full_name }
      })
    ];
  }

  if (domain === "audiobook") {
    return [
      makeOpportunity({
        title: "Audiobook conversion QA workspace",
        problem: "EPUB-to-audio users need to catch bad chapter splits, language detection misses, and pronunciation issues before a long export finishes.",
        targetUser: "Readers converting multilingual EPUBs into personal audiobooks",
        mvpConcept:
          "Preflight an EPUB into chapters, detected languages, sample voices, and warnings before generating the full MP3 set.",
        score: 95,
        rationale: "The repository focuses on multilingual EPUB to MP3 conversion.",
        signalIndexes: [repoSignalIndex],
        profile: { domain, repo: repo.full_name }
      })
    ];
  }

  if (domain === "computer_vision") {
    return [
      makeOpportunity({
        title: "Model demo and failure gallery",
        problem: "Computer vision project users need a quick way to inspect model behavior, compare examples, and understand failure cases.",
        targetUser: "Researchers and developers evaluating the vision model",
        mvpConcept:
          "A lightweight gallery that runs sample inputs, groups outputs by success/failure mode, and links each result back to reproducible commands.",
        score: 92,
        rationale: "The repository appears to be a computer vision or model evaluation project.",
        signalIndexes: [repoSignalIndex],
        profile: { domain, repo: repo.full_name }
      })
    ];
  }

  return [
    makeOpportunity({
      title: "Repo onboarding cockpit",
      problem: "New users need a clear path from cloning the repo to seeing a working result.",
      targetUser: "Developers trying the repository for the first time",
      mvpConcept: "A local dashboard that checks dependencies, runs the first example, and explains failures with linked docs.",
      score: 78,
      rationale: "Repository context is available; first-run experience is a broadly testable wedge.",
      signalIndexes: [repoSignalIndex],
      profile: { domain, repo: repo.full_name }
    })
  ];
}

function scoreCategories(text: string, issues: GitHubIssue[]) {
  const categories = categoryDefinitions();
  return categories
    .map((category) => ({
      ...category,
      score:
        countTerms(text, category.terms) +
        issues.filter((issue) => category.matches(issueSignal(issue))).length * 2
    }))
    .filter((category) => category.score > 0)
    .sort((a, b) => b.score - a.score);
}

function categoryDefinitions() {
  return [
    {
      id: "setup",
      label: "First-run setup helper",
      terms: ["install", "setup", "dependency", "environment", "docker", "build error", "requirements", "quickstart"],
      problem: (repoName: string) => `${repoName} users can lose time getting the first successful local run.`,
      targetUser: () => "Developers trying the project locally",
      mvp: () => "A setup doctor that validates environment, dependencies, sample data, and first-run commands.",
      matches: (signal?: { title?: string | null; body?: string | null }) =>
        includesAny(`${signal?.title ?? ""} ${signal?.body ?? ""}`, ["install", "setup", "dependency", "build", "docker"])
    },
    {
      id: "examples",
      label: "Example and demo launcher",
      terms: ["example", "demo", "tutorial", "readme", "usage", "sample", "notebook"],
      problem: (repoName: string) => `${repoName} needs a faster path from project promise to visible working output.`,
      targetUser: () => "Developers and evaluators scanning the project",
      mvp: () => "A guided demo launcher with one-click sample runs, expected output, and troubleshooting notes.",
      matches: (signal?: { title?: string | null; body?: string | null }) =>
        includesAny(`${signal?.title ?? ""} ${signal?.body ?? ""}`, ["example", "demo", "usage", "sample", "tutorial"])
    },
    {
      id: "performance",
      label: "Performance profiler",
      terms: ["slow", "latency", "performance", "memory", "gpu", "optimize", "runtime", "benchmark"],
      problem: () => "Users need to know which step is slow or resource-heavy before changing model or pipeline code.",
      targetUser: () => "Developers running the project on local or research hardware",
      mvp: () => "A benchmark runner that records runtime, memory, hardware context, and compares runs over time.",
      matches: (signal?: { title?: string | null; body?: string | null }) =>
        includesAny(`${signal?.title ?? ""} ${signal?.body ?? ""}`, ["slow", "performance", "memory", "gpu", "benchmark"])
    },
    {
      id: "evaluation",
      label: "Evaluation harness",
      terms: ["test", "accuracy", "evaluation", "metric", "validate", "regression", "compare"],
      problem: () => "Project maintainers need a repeatable way to tell whether changes improve real outcomes.",
      targetUser: () => "Maintainers and contributors",
      mvp: () => "A small evaluation harness with fixture inputs, metrics, and before/after comparison reports.",
      matches: (signal?: { title?: string | null; body?: string | null }) =>
        includesAny(`${signal?.title ?? ""} ${signal?.body ?? ""}`, ["test", "accuracy", "eval", "metric", "regression"])
    }
  ];
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
        content: "The MVP is narrow, demoable from repository context, and avoids paid or production dependencies.",
        scores: { usefulness: 0.82, coherence: 0.84, differentiation: 0.72 }
      },
      {
        evaluator: "bull",
        content: "The repo already supplies enough context to create a concrete workflow improvement instead of a generic idea.",
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

function inferDomain(text: string, repo: GitHubRepo): string {
  const combined = `${repo.full_name} ${repo.description ?? ""} ${text}`.toLowerCase();
  if (includesAny(combined, ["drone", "airsim", "robot", "mapping", "exploration", "trajectory", "planner"])) {
    return "robotics";
  }
  if (includesAny(combined, ["epub", "audiobook", "mp3", "tts", "voice", "chapter"])) {
    return "audiobook";
  }
  if (includesAny(combined, ["vision", "image", "pose", "detection", "diffusion", "forensics", "spectral"])) {
    return "computer_vision";
  }
  if (includesAny(combined, ["compiler", "jit", "aot", "runtime", "graph"])) {
    return "ml_systems";
  }
  return "developer_tool";
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

function issueSignal(issue: GitHubIssue): { title: string; body: string } {
  return {
    title: issue.title,
    body: `${issue.body ?? ""} ${issue.labels?.map((label) => label.name).join(" ")}`
  };
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

function countTerms(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function includesAny(text: string, terms: string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

function compact(value: string, limit = 700): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}
