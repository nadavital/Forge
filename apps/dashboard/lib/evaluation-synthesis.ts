import type { DbEvaluation, JsonObject } from "@/lib/db/types";

export type EvaluationSynthesis = {
  productPitch?: string;
  mvpScope: string[];
  nonGoals: string[];
  builderSystemPrompt?: string;
  builderReadiness?: string;
};

export function synthesisFromEvaluations(evaluations: DbEvaluation[]): EvaluationSynthesis | undefined {
  const evaluation = evaluations.find((row) => {
    const evaluator = clean(row.evaluator).toLowerCase();
    return evaluator === "synthesizer_agent" || evaluator === "synthesizer";
  });
  if (!evaluation) return undefined;

  const payload = objectValue(evaluation.scores?.payload);
  const productPitch = clean(payload?.product_pitch) || clean(evaluation.content);
  const mvpScope = stringArray(payload?.mvp_scope);
  const nonGoals = stringArray(payload?.non_goals);
  const builderSystemPrompt = clean(payload?.builder_system_prompt);
  const builderReadiness = clean(payload?.builder_readiness);

  if (!productPitch && !mvpScope.length && !nonGoals.length && !builderSystemPrompt) {
    return undefined;
  }

  return {
    productPitch: productPitch || undefined,
    mvpScope,
    nonGoals,
    builderSystemPrompt: builderSystemPrompt || undefined,
    builderReadiness: builderReadiness || undefined
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, 8);
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
