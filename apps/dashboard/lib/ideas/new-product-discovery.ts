import type { DbEvaluation, DbOpportunity, DbSignal, DbUserPreference, JsonObject } from "@/lib/db/types";

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
}): NewProductDiscoveryResult {
  const markets = input.preferences?.preferred_markets?.filter(Boolean) ?? [];
  const notes = clean(input.preferences?.notes);
  const signals = inputSignals({ projectName: input.projectName, markets, notes });
  const opportunities = notes.length >= 80 ? [manualContextOpportunity(input.projectName, notes, markets)] : [];

  return {
    signals,
    opportunities
  };
}

function inputSignals(input: {
  projectName: string;
  markets: string[];
  notes: string;
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

  return signals;
}

function manualContextOpportunity(projectName: string, notes: string, markets: string[]) {
  return makeOpportunity({
    title: `Explore manual idea for ${projectName}`,
    problem: truncate(notes, 320),
    targetUser: markets.length > 0 ? `${markets.join(", ")} users` : "Users described in the supplied product notes",
    mvpConcept: `Build the smallest prototype that tests the supplied product note: ${truncate(notes, 180)}`,
    score: 72,
    rationale: "Created from explicit manual project notes, not from a generic seed template.",
    signalIndexes: [0, 1],
    profile: { origin: "manual_context", markets }
  });
}

function makeOpportunity(input: {
  title: string;
  problem: string;
  targetUser: string;
  mvpConcept: string;
  score: number;
  rationale: string;
  signalIndexes: number[];
  profile: JsonObject;
}) {
  return {
    title: input.title,
    problem: input.problem,
    target_user: input.targetUser,
    mvp_concept: input.mvpConcept,
    score: input.score,
    score_rationale: input.rationale,
    status: "proposed",
    profile: input.profile,
    signalIndexes: input.signalIndexes,
    evaluations: [
      {
        evaluator: "taste_critic",
        content: "The idea is grounded in explicit manual context and should stay narrow enough for a local prototype.",
        scores: { usefulness: 0.84, coherence: 0.82, differentiation: 0.74 }
      },
      {
        evaluator: "bull",
        content: "The supplied notes give enough context to prototype a focused product loop.",
        scores: {}
      },
      {
        evaluator: "bear",
        content: "Manual notes are not market proof; validate with prototype interaction before treating this as demand.",
        scores: {}
      },
      {
        evaluator: "decision_agent",
        content: input.rationale,
        scores: { recommendation: "prototype", confidence: Math.min(0.9, input.score / 100) }
      }
    ]
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
