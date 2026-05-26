export type OpportunityEvidenceState =
  | "brief_only"
  | "source_collected"
  | "repo_evidence"
  | "manual_context"
  | "unknown";

type JsonLike = Record<string, unknown> | null | undefined;

export type OpportunityEvidenceItem = {
  source?: string | null;
  url?: string | null;
};

export type OpportunityEvidenceAssessment = {
  state: OpportunityEvidenceState;
  linkedSignalCount: number;
  citedSourceCount: number;
  sufficientForBuild: boolean;
  reason: string;
};

export function mapOpportunityEvidenceState(profile: JsonLike, evidenceCount: number): OpportunityEvidenceState {
  const state = cleanText(profile?.evidence_state);
  if (state === "brief_only") return "brief_only";
  if (state === "source_collected" || state === "source_backed") return "source_collected";

  const origin = cleanText(profile?.origin);
  if (origin === "antigravity_repo_analysis" || origin === "repo_analysis") return "repo_evidence";
  if (origin === "manual_preference" || origin === "manual_context") return "manual_context";
  if (evidenceCount > 0) return "source_collected";
  return "unknown";
}

export function evidenceStateLabel(state: OpportunityEvidenceState): string {
  if (state === "brief_only") return "Hypothesis";
  if (state === "source_collected") return "Source-backed";
  if (state === "repo_evidence") return "Repo evidence";
  if (state === "manual_context") return "Manual context";
  return "Evidence pending";
}

export function evidenceStateSummary(state: OpportunityEvidenceState, evidenceCount: number): string {
  if (state === "brief_only") {
    return "This came from the approved conversation brief. It still needs public-source evidence before being treated as market research.";
  }
  if (state === "source_collected") {
    return `${evidenceCount} linked source signal${evidenceCount === 1 ? "" : "s"} support this research candidate. Treat as research input, not validated demand.`;
  }
  if (state === "repo_evidence") {
    return `${evidenceCount} linked repo signal${evidenceCount === 1 ? "" : "s"} support this product recommendation.`;
  }
  if (state === "manual_context") {
    return "This came from manual project context or preferences and needs external evidence before build decisions.";
  }
  return "Forge has not attached enough evidence metadata to classify this opportunity yet.";
}

export function assessOpportunityEvidence(input: {
  profile: JsonLike;
  evidenceCount: number;
  evidence?: OpportunityEvidenceItem[];
}): OpportunityEvidenceAssessment {
  const state = mapOpportunityEvidenceState(input.profile, input.evidenceCount);
  const linkedSignalCount = input.evidence?.length ?? input.evidenceCount;
  const citedSourceCount = input.evidence ? input.evidence.filter((item) => cleanText(item.url)).length : 0;
  if (state === "brief_only") {
    return {
      state,
      linkedSignalCount,
      citedSourceCount,
      sufficientForBuild: false,
      reason: "Research this hypothesis before building. It only has the approved conversation brief as evidence."
    };
  }

  if (state === "manual_context" || state === "unknown") {
    return {
      state,
      linkedSignalCount,
      citedSourceCount,
      sufficientForBuild: false,
      reason: "Attach source or repo evidence before building this direction."
    };
  }

  if (state === "source_collected") {
    if (linkedSignalCount < 2) {
      return {
        state,
        linkedSignalCount,
        citedSourceCount,
        sufficientForBuild: false,
        reason: "Collect at least two linked public-source signals before build approval."
      };
    }
    if (input.evidence && citedSourceCount < 1) {
      return {
        state,
        linkedSignalCount,
        citedSourceCount,
        sufficientForBuild: false,
        reason: "Add at least one cited source URL before treating this as build-ready market research."
      };
    }
    return {
      state,
      linkedSignalCount,
      citedSourceCount,
      sufficientForBuild: true,
      reason: "Linked public-source evidence is sufficient for build review."
    };
  }

  if (linkedSignalCount < 1) {
    return {
      state,
      linkedSignalCount,
      citedSourceCount,
      sufficientForBuild: false,
      reason: "Attach linked repo evidence before building this direction."
    };
  }

  return {
    state,
    linkedSignalCount,
    citedSourceCount,
    sufficientForBuild: true,
    reason: "Linked repo evidence is sufficient for build review."
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
