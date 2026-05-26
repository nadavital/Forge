import type { NewProductDiscoveryResult } from "@/lib/ideas/new-product-discovery";
import { installationTokenForConnection } from "../github/github-app.ts";
import type {
  DbGitHubConnection,
  DbProject,
  DbResearchBrief,
  DbSourceConfig,
  DbUserPreference,
  JsonObject
} from "../db/types.ts";

type ManagedResearchResponse = {
  status?: string;
  query?: string;
  summary?: string;
  request_scope?: unknown;
  evidence_summary?: unknown;
  media_items?: unknown[];
  signals?: unknown[];
  opportunities?: unknown[];
};

export type ManagedBriefResearchResult = NewProductDiscoveryResult & {
  metadata: JsonObject;
};

export async function runManagedBriefResearch(input: {
  project?: DbProject;
  preferences?: DbUserPreference;
  researchBrief: DbResearchBrief;
  sources?: DbSourceConfig[];
  githubConnections?: DbGitHubConnection[];
  githubAccessToken?: string | null;
}): Promise<ManagedBriefResearchResult | null> {
  const baseUrl = process.env.FORGE_MANAGED_RESEARCH_URL?.replace(/\/$/, "");
  if (!baseUrl || !managedResearchAuthConfigured()) {
    return null;
  }

  const body = {
    project: {
      id: input.project?.id,
      name: input.project?.name,
      description: input.project?.description,
      product_url: input.project?.product_url,
      owner_user_id: input.project?.owner_user_id,
      workspace_id: input.project?.workspace_id
    },
    preferences: input.preferences,
    research_brief: {
      id: input.researchBrief.id,
      hypothesis: input.researchBrief.hypothesis,
      target_users: input.researchBrief.target_users,
      pain_area: input.researchBrief.pain_area,
      constraints: input.researchBrief.constraints,
      source_plan: input.researchBrief.source_plan,
      disqualifying_evidence: input.researchBrief.disqualifying_evidence,
      mvp_boundaries: input.researchBrief.mvp_boundaries,
      user_taste_notes: input.researchBrief.user_taste_notes,
      open_questions: input.researchBrief.open_questions,
      confidence: input.researchBrief.confidence
    },
    limit_per_source: Number(process.env.FORGE_RESEARCH_LIMIT_PER_SOURCE || 10),
    max_opportunities: Number(process.env.FORGE_RESEARCH_MAX_OPPORTUNITIES || 4),
    ...(await githubAccessPayload(input))
  };

  const response = await fetch(`${baseUrl}/api/research-briefs/run`, {
    method: "POST",
    headers: managedResearchHeaders(input.project),
    signal: AbortSignal.timeout(Number(process.env.FORGE_MANAGED_RESEARCH_TIMEOUT_MS || 120000)),
    body: JSON.stringify(body)
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Managed research failed: ${response.status} ${redactSensitiveText(
        payloadText,
        requestGitHubToken(body),
        process.env.FORGE_MANAGED_RESEARCH_SECRET
      ).slice(0, 600)}`
    );
  }

  const payload = parseManagedResearchPayload(payloadText);
  const signals = signalRows(payload.signals);
  const rawOpportunities = opportunityRows(payload.opportunities);
  const opportunities = rawOpportunities.filter(promotableOpportunity);
  const evaluationRoles = evaluationRolesForPayload(payload.opportunities);
  const evidenceSummary = objectValue(payload.evidence_summary) ?? undefined;
  const mediaAudit = mediaSourceAudit(payload.media_items, input.researchBrief.source_plan);

  return {
    signals,
    opportunities,
    metadata: {
      status: payload.status ?? "completed",
      query: payload.query,
      summary: payload.summary,
      media_item_count: Array.isArray(payload.media_items) ? payload.media_items.length : undefined,
      signal_count: signals.length,
      opportunity_count: rawOpportunities.length,
      promoted_opportunity_count: opportunities.length,
      unpromoted_opportunities: unpromotedOpportunitySummaries(rawOpportunities),
      source_plan: input.researchBrief.source_plan,
      source_plan_routing: mediaAudit.routing,
      media_sources: mediaAudit.sources,
      evaluation_count: rawOpportunities.reduce((sum, opportunity) => sum + (opportunity.evaluations?.length ?? 0), 0),
      evaluation_roles: evaluationRoles,
      evaluation_opportunity_count: evaluatedOpportunityCount(payload.opportunities),
      request_scope: objectValue(payload.request_scope) ?? undefined,
      evidence_summary: evidenceSummary,
      backend_url: baseUrl
    }
  };
}

async function githubAccessPayload(input: {
  researchBrief: DbResearchBrief;
  sources?: DbSourceConfig[];
  githubConnections?: DbGitHubConnection[];
  githubAccessToken?: string | null;
}): Promise<{ github_access_token?: string }> {
  if (!briefMayCollectGitHub(input.researchBrief)) {
    return {};
  }
  const explicit = input.githubAccessToken?.trim();
  if (explicit) {
    return { github_access_token: explicit };
  }

  const githubSource = input.sources?.find(
    (source) => source.source_type === "github" && source.status !== "disabled" && source.connection_id
  );
  const connection = input.githubConnections?.find(
    (candidate) =>
      candidate.id === githubSource?.connection_id &&
      candidate.status === "active" &&
      candidate.provider === "github_app" &&
      candidate.installation_id
  );
  if (!connection) {
    return {};
  }

  const token = await installationTokenForConnection(connection);
  return token ? { github_access_token: token } : {};
}

function briefMayCollectGitHub(brief: DbResearchBrief): boolean {
  const planText = brief.source_plan.join(" ").toLowerCase();
  if (!planText.trim()) {
    return true;
  }
  const mentionsGitHub = /\b(github|git hub|repo|repository|issues?|issue tracker)\b/.test(planText);
  if (mentionsGitHub) {
    return true;
  }
  const mentionsSpecificNonGitHubSource =
    /\b(reddit|subreddit|hacker news|y combinator|hn|stack overflow|stackoverflow|stack exchange|stackexchange|server fault|serverfault|superuser)\b/.test(
      planText
    ) || /(^|[\s,;(/])r\/[a-z0-9_]+/i.test(planText);
  return !mentionsSpecificNonGitHubSource;
}

function managedResearchHeaders(project?: DbProject): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.FORGE_MANAGED_RESEARCH_SECRET?.trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  if (project?.owner_user_id) {
    headers["X-Forge-User-Id"] = project.owner_user_id;
  }
  if (project?.workspace_id) {
    headers["X-Forge-Workspace-Id"] = project.workspace_id;
  }
  return headers;
}

function managedResearchAuthConfigured(): boolean {
  if (process.env.FORGE_MANAGED_RESEARCH_SECRET?.trim()) {
    return true;
  }
  return ["1", "true", "yes"].includes(
    (process.env.FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH || "").toLowerCase()
  );
}

function requestGitHubToken(body: Record<string, unknown>): string | undefined {
  const value = body.github_access_token;
  return typeof value === "string" ? value : undefined;
}

function redactSensitiveText(value: string, ...secrets: Array<string | undefined>): string {
  let redacted = value;
  for (const secret of secrets) {
    const clean = secret?.trim();
    if (clean) {
      redacted = redacted.split(clean).join("[REDACTED]");
    }
  }
  redacted = redacted.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(github_access_token\s*[:=]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(access_token\s*[:=]\s*)[^\s,;"']+/gi, "$1[REDACTED]");
  return redacted;
}

function parseManagedResearchPayload(payloadText: string): ManagedResearchResponse {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error("Managed research returned invalid JSON.");
  }
  const row = objectValue(payload);
  if (!row) {
    throw new Error("Managed research returned a non-object response.");
  }
  if (!Array.isArray(row.signals)) {
    throw new Error("Managed research response is missing a signals array.");
  }
  if (!Array.isArray(row.opportunities)) {
    throw new Error("Managed research response is missing an opportunities array.");
  }
  if (row.media_items !== undefined && !Array.isArray(row.media_items)) {
    throw new Error("Managed research response media_items must be an array when present.");
  }
  return row as ManagedResearchResponse;
}

function signalRows(value: unknown): ManagedBriefResearchResult["signals"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => objectValue(entry))
    .filter((entry): entry is JsonObject => Boolean(entry))
    .map((entry) => ({
      source: clean(entry.source) || "managed_research",
      title: clean(entry.title) || "Untitled signal",
      body: clean(entry.body),
      url: clean(entry.url) || undefined
    }))
    .filter((signal) => signal.title || signal.body);
}

function opportunityRows(value: unknown): ManagedBriefResearchResult["opportunities"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => objectValue(entry))
    .filter((entry): entry is JsonObject => Boolean(entry))
    .map((entry) => {
      const sourceIndexes = Array.isArray(entry.source_indexes)
        ? entry.source_indexes
            .map((item) => (typeof item === "number" ? item : Number(item)))
            .filter((item) => Number.isInteger(item) && item >= 0)
        : [];
      return {
        title: clean(entry.title),
        problem: clean(entry.problem),
        target_user: clean(entry.target_user),
        mvp_concept: clean(entry.mvp_concept),
        score: normalizeScore(entry.score),
        score_rationale: clean(entry.score_rationale),
        status: "proposed",
        profile: {
          ...objectValue(entry.profile),
          origin: "managed_research_brief"
        },
        signalIndexes: sourceIndexes,
        evaluations: evaluationRows(entry.evaluations, entry.score, entry.score_rationale)
      };
    })
    .filter((opportunity) => opportunity.title && opportunity.problem && opportunity.mvp_concept);
}

function promotableOpportunity(opportunity: ManagedBriefResearchResult["opportunities"][number]): boolean {
  return opportunity.profile?.evidence_sufficient_for_build === true;
}

function unpromotedOpportunitySummaries(
  opportunities: ManagedBriefResearchResult["opportunities"]
): Array<{ title: string; reason: string; recommendation?: string }> | undefined {
  const summaries = opportunities
    .filter((opportunity) => !promotableOpportunity(opportunity))
    .map((opportunity) => {
      const reason = clean(opportunity.profile?.evidence_sufficiency_reason) || "Evidence did not clear the build gate.";
      const recommendation = decisionRecommendation(opportunity.evaluations);
      return {
        title: clean(opportunity.title) || "Untitled managed research candidate",
        reason,
        ...(recommendation ? { recommendation } : {})
      };
    });
  return summaries.length ? summaries : undefined;
}

function evaluationRows(
  value: unknown,
  fallbackScore: unknown,
  fallbackRationale: unknown
): ManagedBriefResearchResult["opportunities"][number]["evaluations"] {
  const rows = Array.isArray(value)
    ? value
        .map((entry) => objectValue(entry))
        .filter((entry): entry is JsonObject => Boolean(entry))
        .map((entry) => ({
          evaluator: clean(entry.evaluator) || "managed_research",
          content: clean(entry.content),
          scores: objectValue(entry.scores) ?? {}
        }))
        .filter((entry) => entry.evaluator && entry.content)
    : [];
  if (rows.length > 0) {
    return rows;
  }
  return [
    {
      evaluator: "managed_research",
      content: clean(fallbackRationale),
      scores: {
        overall: normalizeScore(fallbackScore)
      }
    },
    {
      evaluator: "decision_agent",
      content: "Review the source-backed candidate and decide whether to watch, research further, prototype, or build.",
      scores: {
        recommendation: "research_more",
        confidence: Math.min(0.8, normalizeScore(fallbackScore))
      }
    }
  ];
}

function decisionRecommendation(
  evaluations: ManagedBriefResearchResult["opportunities"][number]["evaluations"] | undefined
): string | undefined {
  const decision = evaluations?.find((evaluation) => clean(evaluation.evaluator).toLowerCase() === "decision_agent");
  const recommendation = clean(decision?.scores?.recommendation);
  return recommendation || undefined;
}

function evaluationRolesForPayload(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const roles = new Set<string>();
  for (const opportunity of value) {
    const row = objectValue(opportunity);
    const evaluations = Array.isArray(row?.evaluations) ? row.evaluations : [];
    for (const evaluation of evaluations) {
      const evaluator = clean(objectValue(evaluation)?.evaluator).toLowerCase();
      if (evaluator) roles.add(evaluator);
    }
  }
  return [...roles].sort();
}

function evaluatedOpportunityCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((opportunity) => {
    const row = objectValue(opportunity);
    return Array.isArray(row?.evaluations) && row.evaluations.length > 0;
  }).length;
}

function mediaSourceAudit(
  value: unknown,
  briefSourcePlan: string[]
): {
  sources: Array<{ source: string; count: number }>;
  routing: JsonObject;
} {
  const rows = Array.isArray(value) ? value.map((entry) => objectValue(entry)).filter(Boolean) : [];
  const sourceCounts = new Map<string, number>();
  const enabledSources = new Set<string>();
  const sourcePlan = new Set<string>(briefSourcePlan.map((item) => clean(item)).filter(Boolean));
  const queryHints = new Set<string>();
  const subreddits = new Set<string>();
  const stackExchangeSites = new Set<string>();

  for (const row of rows) {
    const source = clean(row?.source) || "unknown";
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    const metadata = objectValue(row?.metadata);
    for (const item of stringArray(metadata?.source_plan)) sourcePlan.add(item);
    for (const item of stringArray(metadata?.source_plan_query_hints)) queryHints.add(item);
    for (const item of stringArray(metadata?.enabled_sources)) enabledSources.add(item);
    const subreddit = clean(metadata?.subreddit);
    if (subreddit) subreddits.add(subreddit);
    const site = clean(metadata?.site);
    if (site) stackExchangeSites.add(site);
  }

  return {
    sources: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => left.source.localeCompare(right.source)),
    routing: {
      source_plan: [...sourcePlan],
      query_hints: [...queryHints],
      enabled_sources: [...enabledSources],
      reddit_subreddits: [...subreddits],
      stack_exchange_sites: [...stackExchangeSites]
    }
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => clean(item)).filter(Boolean)
    : [];
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.4;
}
