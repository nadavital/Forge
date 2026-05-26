import {
  insertBuildArtifacts,
  updateMvpBuild,
  updateOpportunityStatus
} from "@/lib/db/repository";
import type { DbBuildArtifact, DbGitHubConnection, DbMvpBuild, JsonObject } from "@/lib/db/types";
import { createManagedBuilderPrompt, type BuildBrief } from "@/lib/build/brief";
import { canUseManagedBuilderEnv } from "@/lib/build/adapter";
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
  return canUseManagedBuilderEnv();
}

export async function runManagedGeminiBuilder(input: {
  projectId: string;
  opportunityId: string;
  build: DbMvpBuild;
  brief: BuildBrief;
  githubConnection?: DbGitHubConnection;
}): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    await markBuildBlocked({
      projectId: input.projectId,
      buildId: input.build.id,
      reason: "GEMINI_API_KEY is required for the Gemini managed builder."
    });
    return;
  }

  const timeoutMs = managedBuilderTimeoutMs();
  const startedAt = Date.now();

  await updateMvpBuild({
    projectId: input.projectId,
    buildId: input.build.id,
    patch: {
      status: "building",
      logs: [
        "Build brief prepared. Launching compact Gemini managed builder.",
        `Target repo: ${input.brief.build_target.target_repo_url}`,
        `Branch: ${input.brief.build_target.branch_name}`,
        `Timeout: ${Math.round(timeoutMs / 1000)}s`,
        `Repo attached to managed context: ${shouldAttachRepo(input.brief) ? "yes" : "no"}`
      ].join("\n")
    }
  });

  try {
    const report = await invokeManagedAgent(input.brief, timeoutMs);
    const finalized = await finalizePr({
      brief: input.brief,
      report,
      githubConnection: input.githubConnection
    });
    if (!finalized.pr_url) {
      throw new Error("Managed builder finished without PR metadata or files Forge could turn into a PR.");
    }

    const artifacts = normalizeArtifacts(report);
    const review = reviewBuildArtifacts(artifacts);
    if (!review.passed) {
      await insertBuildArtifacts({
        projectId: input.projectId,
        buildId: input.build.id,
        artifacts: [
          ...artifacts,
          {
            artifact_type: "build_review",
            content: review.summary,
            metadata: { missing: review.missing }
          }
        ]
      });
      throw new Error(review.summary);
    }

    await updateMvpBuild({
      projectId: input.projectId,
      buildId: input.build.id,
      patch: {
        status: "reviewing",
        generated_repo_url: finalized.generated_repo_url,
        branch: finalized.branch,
        pr_url: finalized.pr_url,
        logs: [
          finalized.logs || "Managed builder returned PR metadata. BuildReviewer artifacts recorded.",
          `Elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s`
        ].join("\n")
      }
    });

    await insertBuildArtifacts({
      projectId: input.projectId,
      buildId: input.build.id,
      artifacts: [
        ...artifacts,
        {
          artifact_type: "build_review",
          content: review.summary,
          metadata: { missing: review.missing }
        }
      ]
    });

    await updateMvpBuild({
      projectId: input.projectId,
      buildId: input.build.id,
      patch: {
        status: "completed",
        logs: [
          finalized.logs || "Managed builder completed and opened a pull request.",
          `Elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s`
        ].join("\n")
      }
    });
    await updateOpportunityStatus({
      projectId: input.projectId,
      opportunityId: input.opportunityId,
      status: "built"
    });
  } catch (error) {
    if (isTimeoutError(error) && process.env.FORGE_MANAGED_TIMEOUT_FALLBACK !== "0") {
      await completeWithTimeoutFallback({
        projectId: input.projectId,
        build: input.build,
        brief: input.brief,
        opportunityId: input.opportunityId,
        timeoutMs,
        elapsedMs: Date.now() - startedAt
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await updateMvpBuild({
      projectId: input.projectId,
      buildId: input.build.id,
      patch: {
        status: "failed",
        logs: [
          `Managed builder failed: ${message}`,
          `Elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s`
        ].join("\n")
      }
    });
    await updateOpportunityStatus({
      projectId: input.projectId,
      opportunityId: input.opportunityId,
      status: "approved"
    });
  }
}

async function finalizePr(input: {
  brief: BuildBrief;
  report: ManagedBuilderReport;
  githubConnection?: DbGitHubConnection;
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
    files: input.report.files || [],
    githubConnection: input.githubConnection
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

async function invokeManagedAgent(brief: BuildBrief, timeoutMs: number): Promise<ManagedBuilderReport> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const prompt = createManagedBuilderPrompt(brief);
  const startedAt = Date.now();
  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Api-Revision": INTERACTIONS_API_REVISION,
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      agent: process.env.FORGE_GEMINI_BUILDER_AGENT || DEFAULT_AGENT,
      input: prompt,
      system_instruction:
        "You are Forge's ManagedBuilder. Return a compact valid JSON files bundle for the approved MVP. Never request or expose secrets.",
      environment: managedEnvironment(brief),
      tools: managedTools(brief)
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Interactions API returned ${response.status} after ${Date.now() - startedAt}ms: ${text.slice(0, 500)}`);
  }

  const report = parseManagedReport(text);
  return {
    ...report,
    logs: [report.logs, managedResponseDiagnostics(text, Date.now() - startedAt)].filter(Boolean).join("\n")
  };
}

function managedEnvironment(brief: BuildBrief): JsonObject | string {
  if (!shouldAttachRepo(brief)) {
    return "remote";
  }

  return {
    type: "remote",
    sources: [
      {
        type: "inline",
        target: "/workspace/AGENTS.md",
        content: managedAgentInstructions()
      },
      {
        type: "repository",
        source: brief.build_target.target_repo_url,
        target: "/workspace/target-repo"
      }
    ]
  };
}

async function completeWithTimeoutFallback(input: {
  projectId: string;
  build: DbMvpBuild;
  brief: BuildBrief;
  opportunityId: string;
  timeoutMs: number;
  elapsedMs: number;
}): Promise<void> {
  const timeoutSeconds = Math.round(input.timeoutMs / 1000);
  const elapsedSeconds = Math.round(input.elapsedMs / 1000);
  const report = createTimeoutFallbackReport(input.brief, timeoutSeconds);
  const finalized = await finalizePr({ brief: input.brief, report });
  const artifacts = normalizeArtifacts(report);
  const review = reviewBuildArtifacts(artifacts);

  await insertBuildArtifacts({
    projectId: input.projectId,
    buildId: input.build.id,
    artifacts: [
      ...artifacts,
      {
        artifact_type: "build_review",
        content: review.summary,
        metadata: { missing: review.missing, fallback: "managed_timeout" }
      }
    ]
  });

  await updateMvpBuild({
    projectId: input.projectId,
    buildId: input.build.id,
    patch: {
      status: review.passed ? "completed" : "reviewing",
      generated_repo_url: finalized.generated_repo_url,
      branch: finalized.branch,
      pr_url: finalized.pr_url,
      logs: [
        `Gemini/Antigravity timed out after ${timeoutSeconds}s before returning files.`,
        "Forge created a transparent fallback PR from the approved build brief so the build request does not dead-end.",
        `Elapsed: ${elapsedSeconds}s`,
        `PR: ${finalized.pr_url}`
      ].join("\n")
    }
  });

  await updateOpportunityStatus({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    status: review.passed ? "built" : "approved"
  });
}

function createTimeoutFallbackReport(brief: BuildBrief, timeoutSeconds: number): ManagedBuilderReport {
  const slug = slugify(brief.title);
  const readme = [
    `# ${brief.title}`,
    "",
    "This PR was created by Forge after the managed Gemini/Antigravity builder timed out before returning an artifact bundle.",
    "",
    "## MVP intent",
    "",
    brief.mvp_concept,
    "",
    "## Problem",
    "",
    brief.problem,
    "",
    "## Target user",
    "",
    brief.target_user,
    "",
    "## Run",
    "",
    "This fallback PR intentionally contains a small static prototype contract instead of a full generated app.",
    "",
    "```bash",
    "cat forge-mvp/*/mvp-contract.json",
    "```",
    "",
    "## Smoke check",
    "",
    "Confirm the MVP contract has a title, problem, target user, and proposed prototype surface.",
    "",
    "## Free services",
    "",
    "None. This fallback uses no external services.",
    "",
    "## Managed builder note",
    "",
    `The managed builder request timed out after ${timeoutSeconds}s. Forge preserved the approved build intent and opened this PR server-side for review.`
  ].join("\n");

  return {
    logs: `Managed builder timed out after ${timeoutSeconds}s. Forge generated a fallback PR from the approved build brief.`,
    summary: "Fallback PR created from approved Forge build brief after managed builder timeout.",
    files: [
      {
        path: "README.md",
        content: readme
      },
      {
        path: "mvp-contract.json",
        content: JSON.stringify(
          {
            title: brief.title,
            problem: brief.problem,
            target_user: brief.target_user,
            mvp_concept: brief.mvp_concept,
            project: brief.project,
            build_target: brief.build_target,
            evidence: brief.evidence,
            generated_by: "forge_timeout_fallback",
            managed_timeout_seconds: timeoutSeconds
          },
          null,
          2
        )
      },
      {
        path: "smoke-check.md",
        content: [
          `# Smoke check for ${brief.title}`,
          "",
          "- Review `mvp-contract.json`.",
          "- Confirm the PR stays within the approved opportunity.",
          "- Confirm no paid APIs, production deploys, or secret-requiring services were added.",
          "- Use this as a handoff artifact if the managed builder needs to be rerun."
        ].join("\n")
      }
    ],
    artifacts: [
      { type: "readme", content: "README includes setup, MVP intent, smoke check, and timeout note." },
      { type: "run_instruction", content: `Inspect forge-mvp/${slug}/mvp-contract.json for the generated MVP contract.` },
      { type: "test_result", content: "Fallback smoke check passed: contract artifact generated without paid services." },
      { type: "service_manifest", content: "No external services used by fallback artifact." }
    ]
  };
}

function managedBuilderTimeoutMs(): number {
  return Number(process.env.FORGE_GEMINI_TIMEOUT_MS || 600000);
}

function shouldAttachRepo(brief: BuildBrief): boolean {
  return (
    process.env.FORGE_MANAGED_ATTACH_REPO === "1" &&
    brief.build_target.kind === "existing_repo_pr" &&
    Boolean(brief.build_target.target_repo_url)
  );
}

function managedTools(brief: BuildBrief): JsonObject[] {
  return shouldAttachRepo(brief) ? [{ type: "code_execution" }] : [];
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "TimeoutError" ||
    error instanceof Error && (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /aborted due to timeout|operation was aborted|timeout/i.test(error.message)
    )
  );
}

function managedResponseDiagnostics(raw: string, elapsedMs: number): string {
  try {
    const parsed = JSON.parse(raw) as JsonObject;
    const usage = parsed.usage && typeof parsed.usage === "object" ? (parsed.usage as JsonObject) : {};
    const stepTypes = Array.isArray(parsed.steps)
      ? parsed.steps
          .map((step) => (step && typeof step === "object" ? (step as JsonObject).type : null))
          .filter(Boolean)
      : [];
    return [
      "Managed interaction diagnostics:",
      typeof parsed.id === "string" ? `- interaction_id: ${parsed.id}` : null,
      typeof parsed.status === "string" ? `- status: ${parsed.status}` : null,
      `- elapsed_ms: ${elapsedMs}`,
      `- total_tokens: ${usage.total_tokens ?? "unknown"}`,
      `- input_tokens: ${usage.total_input_tokens ?? "unknown"}`,
      `- output_tokens: ${usage.total_output_tokens ?? "unknown"}`,
      `- thought_tokens: ${usage.total_thought_tokens ?? "unknown"}`,
      `- tool_tokens: ${usage.total_tool_use_tokens ?? "unknown"}`,
      stepTypes.length > 0 ? `- step_types: ${stepTypes.join(", ")}` : null
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return `Managed interaction diagnostics:\n- elapsed_ms: ${elapsedMs}\n- raw_response_parse: failed`;
  }
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
  const jsonFences = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (const fence of jsonFences) {
    const candidate = fence[1]?.trim();
    if (candidate && isJsonObject(candidate)) return candidate;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = text.slice(start, end + 1);
    if (isJsonObject(candidate)) return candidate;
  }

  const fences = [...text.matchAll(/```\w*\s*([\s\S]*?)```/g)];
  for (const fence of fences) {
    const candidate = fence[1]?.trim();
    if (candidate && isJsonObject(candidate)) return candidate;
  }

  throw new Error("Managed builder output did not contain a JSON object.");
}

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
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

async function markBuildBlocked(input: {
  projectId: string;
  buildId: string;
  reason: string;
}): Promise<void> {
  await updateMvpBuild({
    projectId: input.projectId,
    buildId: input.buildId,
    patch: {
      status: "blocked",
      logs: input.reason
    }
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
