import {
  insertBuildArtifacts,
  updateMvpBuild,
  updateOpportunityStatus
} from "@/lib/db/repository";
import type { DbBuildArtifact, DbMvpBuild, JsonObject } from "@/lib/db/types";
import { createManagedBuilderPrompt, type BuildBrief } from "@/lib/build/brief";
import { reviewBuildArtifacts } from "@/lib/build/reviewer";

const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_AGENT = "antigravity-preview-05-2026";

type ManagedBuilderReport = {
  generated_repo_url?: string;
  branch?: string;
  pr_url?: string;
  logs?: string;
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
  if (!input.brief.project.repo_url) {
    await markBuildBlocked(input.build.id, "Project repo URL is required before launching a managed PR build.");
    return;
  }

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
    if (!report.pr_url) {
      throw new Error("Managed builder finished without returning a pull request URL.");
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
      generated_repo_url: report.generated_repo_url || input.brief.project.repo_url,
      branch: report.branch || `forge/${slugify(input.brief.title)}`,
      pr_url: report.pr_url,
      logs: report.logs || "Managed builder returned PR metadata. BuildReviewer artifacts recorded."
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
      logs: report.logs || "Managed builder completed and opened a pull request."
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

async function invokeManagedAgent(brief: BuildBrief): Promise<ManagedBuilderReport> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      agent: process.env.FORGE_GEMINI_BUILDER_AGENT || DEFAULT_AGENT,
      input: createManagedBuilderPrompt(brief),
      system_instruction:
        "You are Forge's ManagedBuilder. Build only the approved MVP, open a GitHub PR, and return final JSON.",
      environment: {
        type: "remote",
        sources: [
          {
            type: "inline",
            target: "AGENTS.md",
            content: managedAgentInstructions()
          }
        ]
      },
      tools: [{ type: "code_execution" }]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Interactions API returned ${response.status}: ${text.slice(0, 500)}`);
  }

  return parseManagedReport(text);
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
  if (typeof value.pr_url === "string" || typeof value.generated_repo_url === "string") {
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

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      artifact_type: "managed_builder_report",
      content: report.logs || "Managed builder opened a pull request.",
      metadata: {
        pr_url: report.pr_url,
        branch: report.branch
      }
    }
  ];
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
    "- Open a pull request in the target repository when the MVP is finalized.",
    "- Include runnable app code, README instructions, and smoke checks.",
    "- Use only code and free services.",
    "- Do not use paid APIs, production deployments, or secret-requiring integrations.",
    "- Return final PR metadata as JSON."
  ].join("\n");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mvp";
}
