import type { DbEvaluation, DbOpportunity, DbSignal, DbUserPreference } from "@/lib/db/types";

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

  return {
    signals,
    opportunities: []
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

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
