import type { DbEvaluation, DbOpportunity, DbResearchBrief, DbSignal, DbUserPreference } from "@/lib/db/types";

export type NewProductDiscoveryResult = {
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
  opportunities: Array<
    Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
      signalIndexes: number[];
      evaluations: Array<Omit<DbEvaluation, "id" | "opportunity_id">>;
    }
  >;
};

export function discoverNewProductIdeas(input: {
  projectName: string;
  preferences?: DbUserPreference;
  researchBrief?: DbResearchBrief;
}): NewProductDiscoveryResult {
  const markets = input.preferences?.preferred_markets?.filter(Boolean) ?? [];
  const notes = clean(input.preferences?.notes);
  const signals = inputSignals({ projectName: input.projectName, markets, notes, researchBrief: input.researchBrief });

  return {
    signals,
    opportunities: input.researchBrief ? [opportunityFromBrief(input.researchBrief)] : []
  };
}

function inputSignals(input: {
  projectName: string;
  markets: string[];
  notes: string;
  researchBrief?: DbResearchBrief;
}): Array<Omit<DbSignal, "id" | "project_id">> {
  const signals: Array<Omit<DbSignal, "id" | "project_id">> = [
    {
      source: "manual_preference",
      title: input.markets.length ? `Preferred markets: ${input.markets.join(", ")}` : `Project context for ${input.projectName}`,
      body: input.notes || "No manual product context supplied yet."
    },
    {
      source: "demo_constraint",
      title: "Demo MVP should be local-first, narrow, and buildable without paid APIs or production deploys.",
      body: "This constraint is part of Forge's generated MVP contract."
    }
  ];

  if (input.researchBrief) {
    signals.unshift({
      source: "research_brief",
      title: input.researchBrief.hypothesis,
      body: [
        input.researchBrief.pain_area ? `Pain area: ${input.researchBrief.pain_area}` : "",
        input.researchBrief.target_users.length
          ? `Target users: ${input.researchBrief.target_users.join(", ")}`
          : "",
        input.researchBrief.source_plan.length
          ? `Source plan: ${input.researchBrief.source_plan.join("; ")}`
          : "",
        input.researchBrief.disqualifying_evidence.length
          ? `Disqualifying evidence: ${input.researchBrief.disqualifying_evidence.join("; ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
  }

  return signals;
}

function opportunityFromBrief(
  brief: DbResearchBrief
): NewProductDiscoveryResult["opportunities"][number] {
  return {
    title: brief.hypothesis || "Research approved product direction",
    problem: brief.pain_area || "The approved idea needs source-backed market research.",
    target_user: brief.target_users.join(", ") || "Target user to verify",
    mvp_concept: brief.mvp_boundaries[0] || "Small prototype shaped by the approved research brief.",
    score: Math.max(0.25, Math.min(0.65, brief.confidence ?? 0.4)),
    score_rationale:
      "This is an approved conversation brief. Treat it as a hypothesis until source agents attach market evidence.",
    status: "researching",
    profile: {
      origin: "ai_intake_research_brief",
      research_brief_id: brief.id,
      source_plan: brief.source_plan,
      disqualifying_evidence: brief.disqualifying_evidence,
      evidence_state: "brief_only"
    },
    signalIndexes: [0],
    evaluations: [
      {
        evaluator: "decision_agent",
        content: "Research more before build. The idea is scoped, but source evidence has not been collected yet.",
        scores: {
          recommendation: "research_more",
          confidence: brief.confidence ?? 0.4
        }
      },
      {
        evaluator: "taste_critic",
        content: "The brief preserves user taste constraints, but Forge should not treat it as market proof."
      },
      {
        evaluator: "bear",
        content: "The strongest objection is missing external evidence from the planned sources."
      }
    ]
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
