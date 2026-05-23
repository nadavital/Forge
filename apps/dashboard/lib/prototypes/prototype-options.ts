import type { DbOpportunity, JsonObject } from "@/lib/db/types";

export type PrototypeOptionDraft = {
  title: string;
  status: "generated";
  artifact_url: string | null;
  artifact_payload: JsonObject;
};

export function createPrototypeOptionDraft(opportunity: DbOpportunity): PrototypeOptionDraft {
  const title = clean(opportunity.title) || "Untitled opportunity";
  const mvp = clean(opportunity.mvp_concept) || "Prototype the smallest credible workflow.";
  const problem = clean(opportunity.problem) || clean(opportunity.score_rationale) || "Validate the opportunity.";

  return {
    title: `${title} demo path`,
    status: "generated",
    artifact_url: null,
    artifact_payload: {
      prototype_type: "clickable_demo",
      opening_screen: title,
      primary_job: problem,
      demo_flow: [
        "Show the painful current state",
        `Let the user complete: ${mvp}`,
        "Surface one visible success metric and one follow-up decision"
      ],
      smoke_checks: [
        "Primary route renders without secrets",
        "Demo data is available locally",
        "User can finish the core loop in under two minutes"
      ]
    }
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
