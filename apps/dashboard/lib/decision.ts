import type { DecisionRecommendation } from "@/types/forge";

export const decisionLabels: Record<DecisionRecommendation, string> = {
  watch: "Watch",
  research_more: "Research",
  prototype: "Prototype",
  build: "Build",
  reject: "Pass"
};

export function isBuildRecommendation(recommendation: DecisionRecommendation): boolean {
  return recommendation === "prototype" || recommendation === "build";
}

export function approveLabel(recommendation: DecisionRecommendation): string {
  if (recommendation === "build") return "Approve build";
  if (recommendation === "prototype") return "Approve & build";
  return "Approve";
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${pluralForm}`;
}
