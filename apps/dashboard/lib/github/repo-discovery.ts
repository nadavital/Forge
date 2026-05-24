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

  const semanticDiscovery = await runSemanticRepoDiscovery({
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
    knowledge: semanticDiscovery.knowledge ?? buildFallbackProjectKnowledge(repo, readme, issues, tree),
    signals,
    opportunities: semanticDiscovery.opportunities
  };
}

function buildFallbackProjectKnowledge(
  repo: GitHubRepo,
  readme: string,
  issues: GitHubIssue[],
  tree: GitHubTreeEntry[]
): JsonObject {
  const files = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const activeIssues = actionableIssues(issues).slice(0, 5);

  return {
    repo: repo.full_name,
    repo_url: repo.html_url,
    description: repo.description,
    primary_language: repo.language,
    topics: repo.topics ?? [],
    semantic_summary: `Forge collected repository context for ${repo.full_name}. Semantic recommendations are pending model analysis.`,
    frameworks: repo.language ? [repo.language] : [],
    app_surfaces: [],
    product_workflows: [],
    evidence_counts: {
      files_seen: files.length,
      issues_seen: issues.filter((issue) => !issue.pull_request).length,
      actionable_issues: activeIssues.length,
      surfaces_detected: 0
    },
    recent_repo_signals: activeIssues.map((issue) => ({
      issue_number: issue.number,
      title: issue.title,
      url: issue.html_url
    })),
    updated_at: new Date().toISOString()
  };
}

async function runSemanticRepoDiscovery(input: {
  repo: GitHubRepo;
  readme: string;
  issues: GitHubIssue[];
  tree: GitHubTreeEntry[];
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
}): Promise<{ knowledge: JsonObject | null; opportunities: RepoDiscoveryResult["opportunities"] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Forge semantic discovery.");
  }

  const payload = await callGeminiJson(apiKey, repoSemanticPrompt(input));
  const knowledge = normalizeKnowledge(payload.project_knowledge, input);
  const opportunities = normalizeOpportunities(payload.opportunities, input);
  return { knowledge, opportunities };
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

function repoSemanticPrompt(input: {
  repo: GitHubRepo;
  readme: string;
  issues: GitHubIssue[];
  tree: GitHubTreeEntry[];
}): string {
  const files = input.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .slice(0, 260);
  const issues = input.issues
    .filter((issue) => !issue.pull_request)
    .slice(0, 12)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: compact(issue.body ?? "", 500),
      labels: issue.labels?.map((label) => label.name).filter(Boolean) ?? [],
      comments: issue.comments,
      url: issue.html_url
    }));

  return `You are Forge's product intelligence agent. Analyze the connected repository and produce project-specific product understanding plus buildable product opportunities.

Rules:
- Do not use generic app categories or canned recommendations.
- Infer the product only from the supplied README, repository files, and issues.
- If the evidence is not enough to recommend real work, return an empty opportunities array.
- Each opportunity must cite concrete evidence file paths or issue URLs from the input.
- Recommendations must be product/user improvements, not code chores, unless the repo evidence clearly says developer setup is the product problem.
- Return only valid JSON with this shape:
{
  "project_knowledge": {
    "semantic_summary": "one concise sentence about what this product is",
    "frameworks": ["framework or platform names inferred from evidence"],
    "product_workflows": ["human-readable workflows inferred from evidence"],
    "app_surfaces": [{"label":"workflow/surface name","evidence_files":["path"]}],
    "uncertainty": "brief note about limits of the evidence"
  },
  "opportunities": [
    {
      "title": "specific product improvement",
      "problem": "user problem grounded in evidence",
      "target_user": "specific user",
      "mvp_concept": "small reviewable implementation",
      "score": 0.0,
      "score_rationale": "why this is worth doing, citing evidence",
      "evidence_files": ["path"],
      "evidence_urls": ["url"]
    }
  ]
}

Repository:
${JSON.stringify(
  {
    name: input.repo.name,
    full_name: input.repo.full_name,
    description: input.repo.description,
    language: input.repo.language,
    topics: input.repo.topics ?? [],
    readme: compact(input.readme, 5000),
    files,
    issues
  },
  null,
  2
)}`;
}

async function callGeminiJson(apiKey: string, prompt: string): Promise<JsonObject> {
  const model = process.env.FORGE_GEMINI_DISCOVERY_MODEL || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini discovery failed: ${response.status} ${body.slice(0, 300)}`);
  }

  const payload = JSON.parse(body) as JsonObject;
  const text = extractGeminiText(payload);
  return JSON.parse(text) as JsonObject;
}

function extractGeminiText(payload: JsonObject): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0];
  if (!first || typeof first !== "object") {
    throw new Error("Gemini response did not include candidates.");
  }
  const content = (first as JsonObject).content;
  const parts =
    content && typeof content === "object" && Array.isArray((content as JsonObject).parts)
      ? ((content as JsonObject).parts as unknown[])
      : [];
  const text = parts
    .map((part) => (part && typeof part === "object" ? (part as JsonObject).text : null))
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .trim();
  if (!text) {
    throw new Error("Gemini response did not include text.");
  }
  return text;
}

function normalizeKnowledge(
  value: unknown,
  input: { repo: GitHubRepo; issues: GitHubIssue[]; tree: GitHubTreeEntry[] }
): JsonObject {
  const knowledge = value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
  const filesSeen = input.tree.filter((entry) => entry.type === "blob").length;
  const appSurfaces = Array.isArray(knowledge.app_surfaces)
    ? knowledge.app_surfaces
        .map((surface) => (surface && typeof surface === "object" ? (surface as JsonObject) : null))
        .filter((surface): surface is JsonObject => Boolean(surface))
        .map((surface) => ({
          label: cleanString(surface.label) || "Detected surface",
          evidence_files: stringArray(surface.evidence_files).slice(0, 8)
        }))
        .slice(0, 8)
    : [];

  return {
    repo: input.repo.full_name,
    repo_url: input.repo.html_url,
    description: input.repo.description,
    primary_language: input.repo.language,
    topics: input.repo.topics ?? [],
    semantic_summary:
      cleanString(knowledge.semantic_summary) ||
      `Forge collected repository context for ${input.repo.full_name}. Semantic recommendations are pending model analysis.`,
    frameworks: stringArray(knowledge.frameworks),
    app_surfaces: appSurfaces,
    product_workflows: stringArray(knowledge.product_workflows).slice(0, 8),
    uncertainty: cleanString(knowledge.uncertainty),
    evidence_counts: {
      files_seen: filesSeen,
      issues_seen: input.issues.filter((issue) => !issue.pull_request).length,
      actionable_issues: actionableIssues(input.issues).length,
      surfaces_detected: appSurfaces.length
    },
    recent_repo_signals: actionableIssues(input.issues)
      .slice(0, 5)
      .map((issue) => ({
        issue_number: issue.number,
        title: issue.title,
        url: issue.html_url
      })),
    updated_at: new Date().toISOString()
  };
}

function normalizeOpportunities(
  value: unknown,
  input: {
    repo: GitHubRepo;
    signals: Array<Omit<DbSignal, "id" | "project_id">>;
  }
): RepoDiscoveryResult["opportunities"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (entry && typeof entry === "object" ? (entry as JsonObject) : null))
    .filter((entry): entry is JsonObject => Boolean(entry))
    .map((entry) => {
      const evidenceUrls = stringArray(entry.evidence_urls);
      const evidenceFiles = stringArray(entry.evidence_files);
      const linkedSignalIndexes = input.signals
        .map((signal, index) => ({ signal, index }))
        .filter(({ index, signal }) => index === 0 || Boolean(signal.url && evidenceUrls.includes(signal.url)))
        .map(({ index }) => index);

      return makeOpportunity({
        title: cleanString(entry.title),
        problem: cleanString(entry.problem),
        targetUser: cleanString(entry.target_user),
        mvpConcept: cleanString(entry.mvp_concept),
        score: normalizeModelScore(entry.score),
        rationale: cleanString(entry.score_rationale),
        signalIndexes: linkedSignalIndexes.length > 0 ? linkedSignalIndexes : [0],
        profile: {
          origin: "gemini_semantic_discovery",
          repo: input.repo.full_name,
          evidence_files: evidenceFiles,
          evidence_urls: evidenceUrls
        }
      });
    })
    .filter((opportunity) => opportunity.title && opportunity.problem && opportunity.mvp_concept)
    .slice(0, 4);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeModelScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 70;
  return score <= 1 ? Math.round(score * 100) : Math.round(score);
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
        content: input.rationale,
        scores: { source: "gemini_semantic_discovery" }
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
