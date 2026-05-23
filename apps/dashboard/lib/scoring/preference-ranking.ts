import type { DbOpportunity, DbPreferenceEvent, DbUserPreference, JsonObject } from "@/lib/db/types";

export type OpportunityDraft = Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
  signalIndexes: number[];
  evaluations?: Array<{ evaluator?: string | null; content?: string | null; scores?: JsonObject | null }>;
};

type ReferenceOpportunity = Pick<
  DbOpportunity,
  "id" | "title" | "problem" | "mvp_concept" | "target_user" | "profile" | "score"
>;

const EVENT_WEIGHTS: Record<string, number> = {
  approved: 10,
  prototype_selected: 8,
  launched: 12,
  feedback: 4,
  reflection_accepted: 3,
  ignored: -4,
  rejected: -10,
  build_failed: -8
};

export function rankOpportunitiesWithPreferences(input: {
  opportunities: OpportunityDraft[];
  existingOpportunities: ReferenceOpportunity[];
  preferenceEvents: DbPreferenceEvent[];
  preferences?: DbUserPreference;
}): OpportunityDraft[] {
  const events = input.preferenceEvents
    .map((event) => ({
      event,
      reference: input.existingOpportunities.find((opportunity) => opportunity.id === event.opportunity_id)
    }))
    .filter((entry) => EVENT_WEIGHTS[entry.event.event_type] !== undefined);

  return input.opportunities
    .map((opportunity) => {
      const baseScore = normalizeScore(opportunity.score);
      const adjustment = events.reduce((total, entry) => {
        const similarity = entry.reference ? opportunitySimilarity(opportunity, entry.reference) : payloadSimilarity(opportunity, entry.event.payload);
        return total + EVENT_WEIGHTS[entry.event.event_type] * similarity;
      }, 0);
      const preferenceFit = explicitPreferenceFit(opportunity, input.preferences);
      const adjustedScore = clamp(Math.round(baseScore + adjustment + preferenceFit), 1, 99);

      return {
        ...opportunity,
        score: adjustedScore,
        score_rationale: appendAdjustment(opportunity.score_rationale, adjustment + preferenceFit),
        profile: {
          ...(opportunity.profile ?? {}),
          preference_adjustment: Number((adjustment + preferenceFit).toFixed(2))
        }
      };
    })
    .sort((a, b) => normalizeScore(b.score) - normalizeScore(a.score));
}

function opportunitySimilarity(candidate: OpportunityDraft, reference: ReferenceOpportunity): number {
  const tokenScore = tokenOverlap(candidateText(candidate), candidateText(reference));
  const profileScore = profileOverlap(candidate.profile, reference.profile);
  const titleMatch = clean(candidate.title).toLowerCase() === clean(reference.title).toLowerCase() ? 1 : 0;
  return clampNumber(Math.max(titleMatch, tokenScore, profileScore), 0.15, 1);
}

function payloadSimilarity(candidate: OpportunityDraft, payload?: JsonObject): number {
  const prompt = typeof payload?.prompt === "string" ? payload.prompt : "";
  const action = typeof payload?.action === "string" ? payload.action : "";
  if (!prompt && !action) return 0.2;
  return clampNumber(tokenOverlap(candidateText(candidate), `${prompt} ${action}`), 0.15, 0.8);
}

function explicitPreferenceFit(opportunity: OpportunityDraft, preferences?: DbUserPreference): number {
  if (!preferences) return 0;
  const text = candidateText(opportunity).toLowerCase();
  const markets = preferences.preferred_markets ?? [];
  const marketBoost = markets.filter((market) => text.includes(market.toLowerCase())).length * 2;
  const notes = clean(preferences.notes).toLowerCase();
  const localFirstBoost = notes.includes("local") && includesAny(text, ["local", "no paid", "free"]) ? 3 : 0;
  const riskPenalty =
    preferences.risk_tolerance === "low" && includesAny(text, ["paid api", "production deploy", "enterprise sales"])
      ? -6
      : 0;
  return marketBoost + localFirstBoost + riskPenalty;
}

function appendAdjustment(rationale: unknown, adjustment: number): string {
  const base = clean(rationale) || "Ranked by evidence, feasibility, and product fit.";
  if (Math.abs(adjustment) < 0.5) return base;
  const direction = adjustment > 0 ? "boosted" : "downweighted";
  return `${base} Preference model ${direction} this by ${Math.abs(Math.round(adjustment))} from prior decisions.`;
}

function candidateText(value: Pick<DbOpportunity, "title" | "problem" | "mvp_concept" | "target_user">): string {
  return [value.title, value.problem, value.mvp_concept, value.target_user].map(clean).join(" ");
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function profileOverlap(left?: JsonObject | null, right?: JsonObject | null): number {
  const leftValues = profileTokens(left);
  const rightValues = profileTokens(right);
  if (!leftValues.size || !rightValues.size) return 0;
  let shared = 0;
  for (const value of leftValues) {
    if (rightValues.has(value)) shared += 1;
  }
  return shared / Math.max(leftValues.size, rightValues.size);
}

function profileTokens(value?: JsonObject | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    Object.values(value)
      .flatMap((item) => (typeof item === "string" ? tokens(item) : []))
      .filter((token) => token.length > 2)
  );
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "that", "this"].includes(token));
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function normalizeScore(score: unknown): number {
  const value = Number(score ?? 0);
  if (!Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
