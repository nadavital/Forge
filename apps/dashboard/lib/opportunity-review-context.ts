import type { JsonObject } from "./db/types.ts";
import type { ContractOpportunity } from "../types/forge.ts";

export function mapOpportunityReviewContext(profile: JsonObject | null | undefined): ContractOpportunity["reviewContext"] {
  const context = {
    sourcePlan: stringArrayFromProfile(profile, "source_plan"),
    constraints: stringArrayFromProfile(profile, "constraints"),
    disqualifyingEvidence: stringArrayFromProfile(profile, "disqualifying_evidence"),
    mvpBoundaries: stringArrayFromProfile(profile, "mvp_boundaries"),
    userTasteNotes: stringArrayFromProfile(profile, "user_taste_notes"),
    openQuestions: stringArrayFromProfile(profile, "open_questions")
  };
  return Object.values(context).some((items) => items.length > 0) ? context : undefined;
}

function stringArrayFromProfile(profile: JsonObject | null | undefined, key: string): string[] {
  const value = profile?.[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 6);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
