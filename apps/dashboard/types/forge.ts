export type DecisionRecommendation = "watch" | "research_more" | "prototype" | "build" | "reject";

export type ContractEvidence = {
  source: string;
  label: string;
  url?: string | null;
};

export type ContractPrototypeOption = {
  id: string;
  title: string;
  status: "proposed" | "generated" | "selected" | "rejected" | "failed";
  artifactUrl?: string | null;
};

export type ContractBuildArtifact = {
  type: string;
  content?: string | null;
  url?: string | null;
};

export type ContractBuild = {
  id?: string;
  status: "queued" | "briefed" | "building" | "reviewing" | "completed" | "failed" | "blocked";
  prUrl?: string | null;
  generatedRepoUrl?: string | null;
  logs?: string | null;
  artifacts?: ContractBuildArtifact[];
};

export type ContractOpportunity = {
  id: string;
  title: string;
  score: number;
  status: string;
  problem: string;
  targetUser: string;
  mvpConcept: string;
  tasteCritique: string;
  decision: {
    recommendation: DecisionRecommendation;
    summary: string;
    confidence: number;
  };
  debate: {
    bull: string;
    bear: string;
  };
  evidence: ContractEvidence[];
  prototypes: ContractPrototypeOption[];
  build?: ContractBuild;
};

export type MorningDigest = {
  summary: string;
  changes: string[];
  topRecommendation?: string;
};

export type MorningReviewProject = {
  id: string;
  name: string;
  mode: string;
  signalCount: number;
  runStatus: string;
  opportunities: ContractOpportunity[];
  digest?: MorningDigest;
};

export type ReviewAction = "approve" | "watch" | "reject" | "research_more";

export type ProjectMode = "connected_product" | "new_product" | "sample_project";

export type ProjectSettingsView = {
  project: {
    repoUrl: string;
    productUrl: string;
    description: string;
  };
  onboarding: {
    status: "complete" | "needs_setup";
    checklist: Array<{
      id: string;
      label: string;
      description: string;
      complete: boolean;
    }>;
  };
  sources: Array<{ id: string; name: string; type: string; status: string }>;
  triggers: Array<{ id: string; name: string; type: string; status: string }>;
  preferences: {
    riskTolerance: string;
    markets: string[];
    notes: string;
  };
};

export type ReflectionProposal = {
  id: string;
  projectId: string;
  title: string;
  rationale: string;
  proposalType: string;
  riskLevel: "low" | "review_required" | "blocked";
  status: "proposed" | "accepted" | "rejected" | "applied";
};

export type ForgeSettingsView = {
  builder: string;
  humanGate: string;
  guardrails: string[];
  reflectionProposals: ReflectionProposal[];
};
