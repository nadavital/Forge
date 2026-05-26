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

export type OpportunityEvidenceState =
  | "brief_only"
  | "source_collected"
  | "repo_evidence"
  | "manual_context"
  | "unknown";

export type ContractOpportunity = {
  id: string;
  title: string;
  score: number;
  status: string;
  evidenceState: OpportunityEvidenceState;
  evidenceLabel: string;
  evidenceSummary: string;
  buildReadiness: {
    canBuild: boolean;
    reason: string;
  };
  reviewContext?: {
    sourcePlan: string[];
    constraints: string[];
    disqualifyingEvidence: string[];
    mvpBoundaries: string[];
    userTasteNotes: string[];
    openQuestions: string[];
  };
  problem: string;
  targetUser: string;
  mvpConcept: string;
  synthesis?: {
    productPitch?: string;
    mvpScope: string[];
    nonGoals: string[];
    builderSystemPrompt?: string;
    builderReadiness?: string;
  };
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
  projectKnowledge?: {
    summary: string;
    frameworks: string[];
    workflows: string[];
    surfaces: Array<{
      label: string;
      evidenceFiles: string[];
    }>;
    evidenceCounts: {
      filesSeen?: number;
      issuesSeen?: number;
      actionableIssues?: number;
      surfacesDetected?: number;
    };
  };
  stages?: Array<{
    label: string;
    status: "completed" | "running" | "waiting" | "failed" | "not_run";
    detail: string;
  }>;
  topRecommendation?: string;
  reflectionProposalCount?: number;
};

export type MorningReviewProject = {
  id: string;
  name: string;
  mode: string;
  modeKey: ProjectMode;
  needsGitHubConnection: boolean;
  signalCount: number;
  runStatus: string;
  opportunities: ContractOpportunity[];
  digest?: MorningDigest;
};

export type AuthSessionView = {
  mode: "hosted_session" | "env_override" | "local_default";
  label: string;
  detail: string;
  signedIn: boolean;
  signInConfigured: boolean;
};

export type AccountSettingsView = {
  authSession: AuthSessionView;
  identity: {
    userId: string;
    workspaceId: string;
    authProvider: "local" | "supabase";
    authSubject: string;
    email?: string | null;
  };
  emailAllowlistEnabled: boolean;
  projectLinks: Array<{
    id: string;
    name: string;
    mode: string;
  }>;
  githubConnections: Array<{
    id: string;
    accountLogin: string;
    accountType?: "User" | "Organization" | null;
    provider: string;
    status: string;
    installationId?: string | null;
    scopes: string[];
  }>;
};

export type ResearchBriefView = {
  id: string;
  status: "needs_context" | "ready_for_research" | "approved" | "running" | "completed";
  hypothesis: string;
  targetUsers: string[];
  painArea: string;
  constraints: string[];
  sourcePlan: string[];
  disqualifyingEvidence: string[];
  mvpBoundaries: string[];
  userTasteNotes: string[];
  openQuestions: string[];
  confidence?: number | null;
};

export type ResearchEvidenceSummaryView = {
  opportunities: number;
  buildReadyOpportunities: number;
  needsMoreEvidenceOpportunities: number;
  reasons: string[];
  sourceAudit?: {
    sources: Array<{ source: string; label: string; count: number }>;
    enabledSources: string[];
    targets: string[];
  };
  status: "ready" | "needs_more_evidence" | "unknown";
  label: string;
  detail: string;
};

export type IdeaConversationView = {
  id: string;
  title: string;
  status: "active" | "brief_ready" | "researching" | "closed";
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  latestBrief?: ResearchBriefView;
  latestResearchRun?: {
    id: string;
    status: string;
    evidenceSummary?: ResearchEvidenceSummaryView;
  };
  agentTasks: Array<{
    id: string;
    pipelineRunId?: string | null;
    role: string;
    phase: string;
    status: "queued" | "running" | "completed" | "failed";
    detail?: string | null;
    stateLabel?: string;
  }>;
};

export type ReviewAction = "approve" | "watch" | "reject" | "research_more";

export type ProjectMode = "connected_product" | "new_product";

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
  sources: Array<{
    id: string;
    name: string;
    type: string;
    displayType: string;
    status: string;
    requiresConnection: boolean;
  }>;
  githubConnections: Array<{
    id: string;
    accountLogin: string;
    accountType?: "User" | "Organization" | null;
    provider: string;
    status: string;
    installationId?: string | null;
    scopes: string[];
  }>;
  githubInstallUrl?: string | null;
  githubUserAuthUrl?: string | null;
  githubAppConfigured: boolean;
  githubOAuthConfigured: boolean;
  githubDevFallbackEnabled: boolean;
  runtimeReadiness: Array<{
    id: string;
    label: string;
    status: "ready" | "partial" | "missing";
    summary: string;
    detail: string;
    missing: string[];
    setup: Array<{
      label: string;
      value: string;
      proof?: {
        kind: "runtime_health" | "callback_flow";
        uncheckedLabel: string;
        provedLabel: string;
        notProvedLabel: string;
      };
    }>;
  }>;
  triggers: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    lastRunAt?: string | null;
    cadence?: string | null;
    intervalHours?: number | null;
    timezone?: string | null;
  }>;
  preferences: {
    riskTolerance: string;
    markets: string[];
    notes: string;
  };
};

export type SchedulerOverview = {
  activeCount: number;
  dueCount: number;
  lastRunAt?: string | null;
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
