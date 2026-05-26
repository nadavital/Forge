import { assessOpportunityEvidence } from "../opportunity-evidence-state.ts";
import type { DbEvaluation, DbOpportunity, DbSignal } from "../db/types.ts";

export type BuildReadiness = {
  canBuild: boolean;
  reason: string;
};

export function buildReadinessForOpportunity(input: {
  opportunity: Pick<DbOpportunity, "status" | "profile">;
  evaluations: Array<Pick<DbEvaluation, "evaluator" | "scores">>;
  evidenceCount: number;
  evidence?: Array<Pick<DbSignal, "source" | "url">>;
}): BuildReadiness {
  const evidence = assessOpportunityEvidence({
    profile: input.opportunity.profile,
    evidenceCount: input.evidenceCount,
    evidence: input.evidence
  });
  if (!evidence.sufficientForBuild) {
    return {
      canBuild: false,
      reason: evidence.reason
    };
  }

  const recommendation = decisionRecommendation(input.evaluations, input.opportunity.status);
  if (recommendation !== "prototype" && recommendation !== "build") {
    return {
      canBuild: false,
      reason: "The current decision recommends more research before build approval."
    };
  }

  return {
    canBuild: true,
    reason: "Evidence and decision state are ready for a build approval."
  };
}

function decisionRecommendation(
  evaluations: Array<Pick<DbEvaluation, "evaluator" | "scores">>,
  status: string | null | undefined
): string {
  const decision = evaluations.find((evaluation) => evaluation.evaluator === "decision_agent");
  const recommendation = decision?.scores?.recommendation;
  if (typeof recommendation === "string" && recommendation.trim()) {
    return recommendation.trim().toLowerCase().replace(/\s+/g, "_");
  }
  if (status === "approved" || status === "building" || status === "built") return "build";
  if (status === "watching") return "watch";
  if (status === "researching") return "research_more";
  if (status === "rejected") return "reject";
  return "prototype";
}
