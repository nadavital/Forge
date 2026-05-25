import type { DbEvaluation, DbOpportunity, DbSignal, JsonObject } from "@/lib/db/types";

const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const INTERACTIONS_API_REVISION = "2026-05-20";
const DEFAULT_AGENT = "antigravity-preview-05-2026";

export type RepoAnalysisResult = {
  knowledge: JsonObject;
  opportunities: Array<
    Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
      signalIndexes: number[];
      evaluations: Array<Omit<DbEvaluation, "id" | "opportunity_id">>;
    }
  >;
  metadata: JsonObject;
};

export async function runAntigravityRepoAnalysis(input: {
  repoUrl: string;
  repoName: string;
  productContext: string;
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
  repoScan: JsonObject;
}): Promise<RepoAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Antigravity repo analysis.");
  }

  const startedAt = Date.now();
  const raw = await createInteraction({
    apiKey,
    repoUrl: input.repoUrl,
    prompt: repoAnalysisPrompt(input),
    timeoutMs: Number(process.env.FORGE_REPO_ANALYSIS_TIMEOUT_MS || 900000)
  });
  const payload = extractJsonObject(raw);
  const knowledge = normalizeKnowledge(payload.project_knowledge, input, Date.now() - startedAt);
  const opportunities = normalizeOpportunities(payload.opportunities, input);

  return {
    knowledge,
    opportunities,
    metadata: {
      status: "completed",
      agent: process.env.FORGE_REPO_ANALYSIS_AGENT || DEFAULT_AGENT,
      elapsed_ms: Date.now() - startedAt,
      opportunity_count: opportunities.length,
      knowledge_summary: knowledge.semantic_summary,
      repo_scan: input.repoScan
    }
  };
}

async function createInteraction(input: {
  apiKey: string;
  repoUrl: string;
  prompt: string;
  timeoutMs: number;
}): Promise<string> {
  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Api-Revision": INTERACTIONS_API_REVISION,
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey
    },
    signal: AbortSignal.timeout(input.timeoutMs),
    body: JSON.stringify({
      agent: process.env.FORGE_REPO_ANALYSIS_AGENT || DEFAULT_AGENT,
      input: input.prompt,
      system_instruction:
        "You are Forge's RepoAnalysisAgent. Inspect the attached repository deeply and return strict JSON only.",
      environment: {
        type: "remote",
        sources: [
          {
            type: "inline",
            target: "/workspace/AGENTS.md",
            content: repoAnalysisInstructions()
          },
          {
            type: "repository",
            source: input.repoUrl,
            target: "/workspace/target-repo"
          }
        ]
      },
      tools: [{ type: "code_execution" }]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Antigravity repo analysis failed: ${response.status} ${text.slice(0, 600)}`);
  }
  return interactionText(text);
}

function repoAnalysisPrompt(input: {
  repoUrl: string;
  repoName: string;
  productContext: string;
  repoScan: JsonObject;
}): string {
  return `Analyze this connected Forge project by inspecting the attached repository at /workspace/target-repo.

Repository: ${input.repoName}
URL: ${input.repoUrl}
Initial context: ${input.productContext}
Fast repo scan:
${JSON.stringify(input.repoScan, null, 2)}

Return only JSON with this exact shape:
{
  "project_knowledge": {
    "semantic_summary": "one clear sentence about what the product is",
    "frameworks": ["platform/framework names"],
    "product_workflows": ["actual user workflows found in the repo"],
    "app_surfaces": [
      {
        "label": "workflow or surface",
        "evidence_files": ["repo-relative path"],
        "summary": "what this surface does"
      }
    ],
    "architecture_notes": ["important implementation boundaries"],
    "risks": ["repo-grounded risks or uncertainty"],
    "uncertainty": "what is still unclear"
  },
  "opportunities": [
    {
      "title": "specific product improvement",
      "problem": "user problem grounded in the repo",
      "target_user": "specific user",
      "mvp_concept": "small reviewable implementation",
      "score": 0.0,
      "score_rationale": "why this is worth doing",
      "evidence_files": ["repo-relative path"],
      "evidence_urls": ["issue or doc URL if relevant"],
      "risks": ["why this may be wrong or too broad"]
    }
  ]
}`;
}

function repoAnalysisInstructions(): string {
  return [
    "# Forge RepoAnalysisAgent",
    "",
    "Inspect the repository in /workspace/target-repo before writing recommendations.",
    "Do not make code changes, commit, push, or open PRs.",
    "Use shell/code execution only for read-only inspection.",
    "Prefer product semantics over filename keyword matching.",
    "Every opportunity must cite concrete repo-relative files or issue URLs.",
    "If you cannot justify an opportunity from repo evidence, return no opportunities.",
    "Do not use hardcoded product categories, generic app advice, or template recommendations.",
    "Return strict JSON only."
  ].join("\n");
}

function normalizeKnowledge(
  value: unknown,
  input: { repoUrl: string; repoName: string; repoScan: JsonObject },
  elapsedMs: number
): JsonObject {
  const knowledge = objectValue(value) ?? {};
  const surfaces = Array.isArray(knowledge.app_surfaces)
    ? knowledge.app_surfaces
        .map((surface) => objectValue(surface))
        .filter((surface): surface is JsonObject => Boolean(surface))
        .map((surface) => ({
          label: cleanString(surface.label) || "Detected surface",
          summary: cleanString(surface.summary),
          evidence_files: stringArray(surface.evidence_files).slice(0, 8)
        }))
        .slice(0, 8)
    : [];
  const repoScan = objectValue(input.repoScan) ?? {};

  return {
    repo: input.repoName,
    repo_url: input.repoUrl,
    semantic_summary:
      cleanString(knowledge.semantic_summary) || `Antigravity inspected ${input.repoName}, but returned no summary.`,
    frameworks: stringArray(knowledge.frameworks),
    product_workflows: stringArray(knowledge.product_workflows).slice(0, 8),
    app_surfaces: surfaces,
    architecture_notes: stringArray(knowledge.architecture_notes),
    risks: stringArray(knowledge.risks),
    uncertainty: cleanString(knowledge.uncertainty),
    evidence_counts: {
      files_seen: numberValue(repoScan.files_seen),
      issues_seen: numberValue(repoScan.issues_seen),
      actionable_issues: numberValue(repoScan.actionable_issues),
      surfaces_detected: surfaces.length
    },
    analysis_agent: {
      name: process.env.FORGE_REPO_ANALYSIS_AGENT || DEFAULT_AGENT,
      elapsed_ms: elapsedMs
    },
    updated_at: new Date().toISOString()
  };
}

function normalizeOpportunities(
  value: unknown,
  input: {
    repoName: string;
    signals: Array<Omit<DbSignal, "id" | "project_id">>;
  }
): RepoAnalysisResult["opportunities"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => objectValue(entry))
    .filter((entry): entry is JsonObject => Boolean(entry))
    .map((entry) => {
      const evidenceUrls = stringArray(entry.evidence_urls);
      const evidenceFiles = stringArray(entry.evidence_files);
      const signalIndexes = input.signals
        .map((signal, index) => ({ signal, index }))
        .filter(({ index, signal }) => index === 0 || Boolean(signal.url && evidenceUrls.includes(signal.url)))
        .map(({ index }) => index);

      return makeOpportunity({
        title: cleanString(entry.title),
        problem: cleanString(entry.problem),
        targetUser: cleanString(entry.target_user),
        mvpConcept: cleanString(entry.mvp_concept),
        score: normalizeScore(entry.score),
        rationale: cleanString(entry.score_rationale),
        signalIndexes: signalIndexes.length ? signalIndexes : [0],
        profile: {
          origin: "antigravity_repo_analysis",
          repo: input.repoName,
          evidence_files: evidenceFiles,
          evidence_urls: evidenceUrls,
          risks: stringArray(entry.risks)
        }
      });
    })
    .filter((opportunity) => opportunity.title && opportunity.problem && opportunity.mvp_concept)
    .slice(0, 4);
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
}): RepoAnalysisResult["opportunities"][number] {
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
        scores: { source: "antigravity_repo_analysis" }
      },
      {
        evaluator: "decision_agent",
        content: input.rationale,
        scores: { recommendation: "prototype", confidence: Math.min(0.9, Number(input.score) / 100) }
      }
    ]
  };
}

function interactionText(raw: string): string {
  const payload = JSON.parse(raw) as JsonObject;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const parts: string[] = [];
  for (const step of steps) {
    const stepObject = objectValue(step);
    if (!stepObject || stepObject.type !== "model_output" || !Array.isArray(stepObject.content)) {
      continue;
    }
    for (const item of stepObject.content) {
      const text = objectValue(item)?.text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  if (!parts.length) {
    return raw;
  }
  return parts.join("\n");
}

function extractJsonObject(text: string): JsonObject {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonObject;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1]) as JsonObject;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as JsonObject;
  }
  throw new Error("Antigravity repo analysis did not return JSON.");
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 70;
  return score <= 1 ? Math.round(score * 100) : Math.round(score);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
