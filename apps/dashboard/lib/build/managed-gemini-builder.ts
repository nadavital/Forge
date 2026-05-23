import {
  insertBuildArtifacts,
  updateMvpBuild,
  updateOpportunityStatus
} from "@/lib/db/repository";
import type { DbBuildArtifact, DbMvpBuild, JsonObject } from "@/lib/db/types";
import { createManagedBuilderPrompt, type BuildBrief } from "@/lib/build/brief";
import { reviewBuildArtifacts } from "@/lib/build/reviewer";
import { createGitHubPrFromFiles } from "@/lib/build/github-pr";

const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const INTERACTIONS_API_REVISION = "2026-05-20";
const DEFAULT_AGENT = "antigravity-preview-05-2026";

type ManagedBuilderReport = {
  generated_repo_url?: string;
  branch?: string;
  branch_name?: string;
  pr_url?: string;
  logs?: string;
  summary?: string;
  files?: Array<{
    path?: string;
    content?: string | null;
  }>;
  artifacts?: Array<{
    type?: string;
    content?: string | null;
    url?: string | null;
    metadata?: JsonObject | null;
  }>;
};

export function canUseManagedGeminiBuilder(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function runManagedGeminiBuilder(input: {
  projectId: string;
  opportunityId: string;
  build: DbMvpBuild;
  brief: BuildBrief;
}): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    await markBuildBlocked(input.build.id, "GEMINI_API_KEY is required for the Gemini managed builder.");
    return;
  }

  await updateMvpBuild(input.build.id, {
    status: "briefed",
    logs: "Build brief prepared. Launching Gemini managed builder."
  });

  try {
    const report = await invokeManagedAgent(input.brief);
    const finalized = await finalizePr({ brief: input.brief, report });
    if (!finalized.pr_url) {
      throw new Error("Managed builder finished without PR metadata or files Forge could turn into a PR.");
    }

    const artifacts = normalizeArtifacts(report);
    const review = reviewBuildArtifacts(artifacts);
    if (!review.passed) {
      await insertBuildArtifacts(input.build.id, [
        ...artifacts,
        {
          artifact_type: "build_review",
          content: review.summary,
          metadata: { missing: review.missing }
        }
      ]);
      throw new Error(review.summary);
    }

    await updateMvpBuild(input.build.id, {
      status: "reviewing",
      generated_repo_url: finalized.generated_repo_url,
      branch: finalized.branch,
      pr_url: finalized.pr_url,
      logs: finalized.logs || "Managed builder returned PR metadata. BuildReviewer artifacts recorded."
    });

    await insertBuildArtifacts(input.build.id, [
      ...artifacts,
      {
        artifact_type: "build_review",
        content: review.summary,
        metadata: { missing: review.missing }
      }
    ]);

    await updateMvpBuild(input.build.id, {
      status: "completed",
      logs: finalized.logs || "Managed builder completed and opened a pull request."
    });
    await updateOpportunityStatus(input.opportunityId, "built");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateMvpBuild(input.build.id, {
      status: "failed",
      logs: `Managed builder failed: ${message}`
    });
    await updateOpportunityStatus(input.opportunityId, "approved");
  }
}

async function finalizePr(input: {
  brief: BuildBrief;
  report: ManagedBuilderReport;
}): Promise<ManagedBuilderReport & { generated_repo_url: string; branch: string; pr_url: string }> {
  if (input.report.pr_url) {
    return {
      ...input.report,
      generated_repo_url: input.report.generated_repo_url || input.brief.build_target.target_repo_url,
      branch: input.report.branch || input.report.branch_name || input.brief.build_target.branch_name,
      pr_url: input.report.pr_url,
      logs: input.report.logs || input.report.summary
    };
  }

  const materialized = await createGitHubPrFromFiles({
    brief: input.brief,
    files: input.report.files || []
  });

  return {
    ...input.report,
    generated_repo_url: materialized.generatedRepoUrl,
    branch: materialized.branch,
    pr_url: materialized.prUrl,
    logs:
      input.report.logs ||
      input.report.summary ||
      "Managed builder returned files; Forge created the GitHub branch and pull request server-side."
  };
}

async function invokeManagedAgent(brief: BuildBrief): Promise<ManagedBuilderReport> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Api-Revision": INTERACTIONS_API_REVISION,
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    signal: AbortSignal.timeout(Number(process.env.FORGE_GEMINI_TIMEOUT_MS || 300000)),
    body: JSON.stringify({
      agent: process.env.FORGE_GEMINI_BUILDER_AGENT || DEFAULT_AGENT,
      input: createManagedBuilderPrompt(brief),
      system_instruction:
        "You are Forge's ManagedBuilder. Build only the approved MVP, return valid JSON, and never request or expose secrets.",
      environment: managedEnvironment(brief),
      tools: [{ type: "code_execution" }, { type: "google_search" }, { type: "url_context" }]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Interactions API returned ${response.status}: ${text.slice(0, 500)}`);
  }

  return parseManagedReport(text);
}

function managedEnvironment(brief: BuildBrief): JsonObject | string {
  const sources: JsonObject[] = [
    {
      type: "inline",
      target: "/workspace/AGENTS.md",
      content: managedAgentInstructions()
    }
  ];

  if (brief.build_target.kind === "existing_repo_pr" && brief.build_target.target_repo_url) {
    sources.push({
      type: "repository",
      source: brief.build_target.target_repo_url,
      target: "/workspace/target-repo"
    });
  }

  return {
    type: "remote",
    sources
  };
}

function parseManagedReport(raw: string): ManagedBuilderReport {
  const parsed = JSON.parse(raw) as JsonObject;
  const direct = coerceReport(parsed);
  if (direct) return direct;

  const outputText = extractOutputText(parsed);
  if (!outputText) {
    throw new Error("Managed builder response did not include text output.");
  }

  const jsonText = extractJsonObject(outputText);
  return JSON.parse(jsonText) as ManagedBuilderReport;
}

function coerceReport(value: JsonObject): ManagedBuilderReport | null {
  if (typeof value.pr_url === "string" || typeof value.generated_repo_url === "string" || Array.isArray(value.files)) {
    return value as ManagedBuilderReport;
  }
  return null;
}

function extractOutputText(value: JsonObject): string {
  if (typeof value.output_text === "string") return value.output_text;
  if (Array.isArray(value.outputs)) {
    return value.outputs
      .map((output) => {
        if (!output || typeof output !== "object") return "";
        const record = output as JsonObject;
        if (typeof record.text === "string") return record.text;
        if (typeof record.output_text === "string") return record.output_text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(value.candidates)) {
    return value.candidates
      .flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const content = (candidate as JsonObject).content;
        if (!content || typeof content !== "object") return [];
        const parts = (content as JsonObject).parts;
        if (!Array.isArray(parts)) return [];
        return parts.map((part) => {
          if (!part || typeof part !== "object") return "";
          const text = (part as JsonObject).text;
          return typeof text === "string" ? text : "";
        });
      })
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(value.steps)) {
    return value.steps
      .flatMap((step) => {
        if (!step || typeof step !== "object") return [];
        const record = step as JsonObject;
        if (record.type !== "model_output" || !Array.isArray(record.content)) return [];
        return record.content.map((content) => {
          if (!content || typeof content !== "object") return "";
          const text = (content as JsonObject).text;
          return typeof text === "string" ? text : "";
        });
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  throw new Error("Managed builder output did not contain a JSON object.");
}

function normalizeArtifacts(report: ManagedBuilderReport): Array<Omit<DbBuildArtifact, "id" | "mvp_build_id">> {
  const artifacts = Array.isArray(report.artifacts) ? report.artifacts : [];
  const normalized = artifacts
    .filter((artifact) => artifact && typeof artifact.type === "string")
    .map((artifact) => ({
      artifact_type: artifact.type || "artifact",
      content: artifact.content ?? null,
      url: artifact.url ?? null,
      metadata: artifact.metadata ?? null
    }));

  const byType = new Set(normalized.map((artifact) => artifact.artifact_type));
  const files = Array.isArray(report.files) ? report.files : [];
  const readme = files.find((file) => file.path?.toLowerCase().endsWith("readme.md"));

  if (readme?.content && !byType.has("readme")) {
    normalized.push({
      artifact_type: "readme",
      content: readme.content.slice(0, 4000),
      url: null,
      metadata: { source: "generated_file", path: readme.path }
    });
    byType.add("readme");
  }

  if (!byType.has("run_instruction")) {
    normalized.push({
      artifact_type: "run_instruction",
      content: extractReadmeSection(readme?.content || "", "run") || "Install dependencies and run the app locally using the generated README instructions.",
      url: null,
      metadata: { source: readme?.content ? "generated_readme" : "forge_inferred" }
    });
    byType.add("run_instruction");
  }

  if (!byType.has("test_result")) {
    normalized.push({
      artifact_type: "test_result",
      content: report.summary || report.logs || "Managed builder generated smoke-checkable code and README instructions.",
      url: null,
      metadata: { source: "managed_builder_summary" }
    });
    byType.add("test_result");
  }

  if (!byType.has("service_manifest")) {
    normalized.push({
      artifact_type: "service_manifest",
      content:
        extractReadmeSection(readme?.content || "", "services") ||
        "No paid APIs, production deployments, or secret-requiring integrations are required for this MVP.",
      url: null,
      metadata: { source: readme?.content ? "generated_readme" : "forge_inferred" }
    });
    byType.add("service_manifest");
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      artifact_type: "managed_builder_report",
      content: report.logs || "Managed builder opened a pull request.",
      metadata: {
        pr_url: report.pr_url,
        branch: report.branch || report.branch_name,
        generated_repo_url: report.generated_repo_url
      }
    }
  ];
}

function extractReadmeSection(content: string, heading: string): string {
  if (!content) return "";
  const pattern = new RegExp(`(^|\\n)#{2,3}\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s+|$)`, "i");
  return pattern.exec(content)?.[2]?.trim().slice(0, 2000) || "";
}

async function markBuildBlocked(buildId: string, reason: string): Promise<void> {
  await updateMvpBuild(buildId, {
    status: "blocked",
    logs: reason
  });
}

function managedAgentInstructions(): string {
  return [
    "Forge generated MVP rules:",
    "- Stay within the approved opportunity.",
    "- Use the configured target repository and template repo.",
    "- If GitHub credentials are unavailable in the sandbox, return a files[] bundle and let Forge open the PR.",
    "- For new products, prepare a generated repository MVP. For existing products, prepare a PR against the connected repository.",
    "- Include runnable app code, README instructions, and smoke checks.",
    "- Use only code and free services.",
    "- Do not use paid APIs, production deployments, or secret-requiring integrations.",
    "- Return final PR metadata as JSON."
  ].join("\n");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mvp";
}
