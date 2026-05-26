import type { JsonObject } from "../db/types.ts";

type EvidenceSummary = {
  opportunities: number;
  buildReadyOpportunities: number;
  needsMoreEvidenceOpportunities: number;
  reasons: string[];
};

export function taskUpdatesForResearch(
  tasks: Array<{ id: string; agent_role: string }>,
  metadata?: Record<string, unknown>
): Array<{
  id: string;
  status: "queued" | "completed";
  result: JsonObject;
}> {
  if (!metadata) {
    return tasks.map((task) => ({
      id: task.id,
      status: "queued",
      result: {
        status: "waiting_for_managed_research_backend",
        summary: "Waiting for FORGE_MANAGED_RESEARCH_URL and FORGE_MANAGED_RESEARCH_SECRET before this role can run."
      }
    }));
  }
  return tasks.map((task) => {
    const evaluationRoles = normalizedEvaluationRoles(metadata.evaluation_roles);
    const hasEvaluations = Number(metadata.evaluation_count ?? 0) > 0;
    const completed =
      task.agent_role === "SourceCollector" ||
      task.agent_role === "Researcher" ||
      evaluationCompleteForRole(task.agent_role, evaluationRoles, hasEvaluations);
    return {
      id: task.id,
      status: completed ? "completed" : "queued",
      result: completed
        ? {
            status: "completed",
            summary: taskSummary(task.agent_role, metadata),
            managed_research: metadata
          }
        : {
            status: "waiting_for_evaluation",
            summary: waitingSummary(task.agent_role, evaluationRoles),
            reason: "source collection finished; role-specific evaluation did not return yet",
            received_evaluation_roles: evaluationRoles
          }
    };
  });
}

function taskSummary(role: string, metadata: Record<string, unknown>): string {
  const signalCount = Number(metadata.signal_count ?? 0);
  const opportunityCount = Number(metadata.opportunity_count ?? 0);
  const evaluationCount = Number(metadata.evaluation_count ?? 0);
  const evaluatedOpportunityCount = Number(metadata.evaluation_opportunity_count ?? 0);
  const evidence = evidenceSummary(metadata);
  if (role === "SourceCollector") {
    return `Collected ${signalCount} source signal${signalCount === 1 ? "" : "s"}.`;
  }
  if (role === "Researcher") {
    return [
      `Synthesized ${opportunityCount} candidate${opportunityCount === 1 ? "" : "s"} from source evidence.`,
      evidence ? evidenceProgressSummary(evidence) : ""
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (role === "TasteCritic") {
    return `Recorded taste critique across ${evaluatedOpportunityCount || opportunityCount} candidate${(evaluatedOpportunityCount || opportunityCount) === 1 ? "" : "s"}.`;
  }
  if (role === "BullAgent" || role === "BearAgent") {
    return `Recorded ${role === "BullAgent" ? "bull" : "bear"} case evidence from ${evaluationCount} evaluation row${evaluationCount === 1 ? "" : "s"}.`;
  }
  if (role === "DecisionAgent") {
    if (evidence && evidence.opportunities > 0 && evidence.buildReadyOpportunities === 0) {
      return `Recommended more research for ${evidence.needsMoreEvidenceOpportunities || evidence.opportunities} candidate${
        (evidence.needsMoreEvidenceOpportunities || evidence.opportunities) === 1 ? "" : "s"
      } before build. ${evidence.reasons[0] || "The evidence gate has not cleared yet."}`;
    }
    return `Recorded decision guidance for ${evaluatedOpportunityCount || opportunityCount} candidate${(evaluatedOpportunityCount || opportunityCount) === 1 ? "" : "s"}.`;
  }
  if (role === "Synthesizer") {
    if (evidence && evidence.opportunities > 0 && evidence.buildReadyOpportunities === 0) {
      return `Recorded synthesis notes, but no candidate cleared the build evidence gate yet.`;
    }
    if (evidence && evidence.buildReadyOpportunities > 0) {
      return `Recorded synthesized build direction for ${evidence.buildReadyOpportunities} build-ready candidate${
        evidence.buildReadyOpportunities === 1 ? "" : "s"
      }.`;
    }
    return `Recorded synthesized build direction for ${evaluatedOpportunityCount || opportunityCount} candidate${(evaluatedOpportunityCount || opportunityCount) === 1 ? "" : "s"}.`;
  }
  return "Completed managed research task.";
}

function evidenceSummary(metadata: Record<string, unknown>): EvidenceSummary | null {
  const summary = objectValue(metadata.evidence_summary);
  if (!summary) return null;
  return {
    opportunities: numberValue(summary.opportunities) ?? 0,
    buildReadyOpportunities: numberValue(summary.build_ready_opportunities) ?? 0,
    needsMoreEvidenceOpportunities: numberValue(summary.needs_more_evidence_opportunities) ?? 0,
    reasons: stringArray(summary.reasons)
  };
}

function evidenceProgressSummary(evidence: EvidenceSummary): string {
  if (evidence.opportunities === 0) {
    return "No candidate evidence was ready to review.";
  }
  if (evidence.buildReadyOpportunities > 0) {
    return `${evidence.buildReadyOpportunities}/${evidence.opportunities} candidate${
      evidence.opportunities === 1 ? "" : "s"
    } cleared the build evidence gate.`;
  }
  return `${evidence.needsMoreEvidenceOpportunities || evidence.opportunities} candidate${
    (evidence.needsMoreEvidenceOpportunities || evidence.opportunities) === 1 ? "" : "s"
  } still need more cited evidence.`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function normalizedEvaluationRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((role) => (typeof role === "string" ? role.toLowerCase() : "")).filter(Boolean).sort();
}

function evaluationCompleteForRole(role: string, evaluationRoles: string[], hasEvaluations: boolean): boolean {
  if (!["TasteCritic", "BullAgent", "BearAgent", "DecisionAgent", "Synthesizer"].includes(role)) {
    return false;
  }
  if (evaluationRoles.length === 0) {
    return hasEvaluations;
  }
  if (role === "TasteCritic") {
    return evaluationRoles.includes("taste_critic");
  }
  if (role === "BullAgent") {
    return evaluationRoles.includes("bull") || evaluationRoles.includes("bull_agent");
  }
  if (role === "BearAgent") {
    return evaluationRoles.includes("bear") || evaluationRoles.includes("bear_agent");
  }
  if (role === "DecisionAgent") {
    return evaluationRoles.includes("decision_agent");
  }
  if (role === "Synthesizer") {
    return evaluationRoles.includes("synthesizer_agent") || evaluationRoles.includes("synthesizer");
  }
  return false;
}

function waitingSummary(role: string, evaluationRoles: string[]): string {
  const received = evaluationRoles.length ? ` Received: ${evaluationRoles.join(", ")}.` : "";
  if (role === "TasteCritic") return `Waiting for taste critique.${received}`;
  if (role === "BullAgent") return `Waiting for bull case.${received}`;
  if (role === "BearAgent") return `Waiting for bear case.${received}`;
  if (role === "DecisionAgent") return `Waiting for decision guidance.${received}`;
  if (role === "Synthesizer") return `Waiting for synthesized build direction.${received}`;
  return `Waiting for evaluation.${received}`;
}
