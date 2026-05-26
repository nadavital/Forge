export type JsonObject = Record<string, unknown>;

export type DbUser = {
  id: string;
  email?: string | null;
  display_name?: string | null;
  created_at?: string;
};

export type DbWorkspace = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at?: string;
};

export type DbWorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  created_at?: string;
};

export type DbUserAuthIdentity = {
  id: string;
  user_id: string;
  provider: string;
  subject: string;
  email?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DbProject = {
  id: string;
  owner_user_id?: string | null;
  workspace_id?: string | null;
  name: string;
  mode: string;
  stage?: string | null;
  description?: string | null;
  repo_url?: string | null;
  product_url?: string | null;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DbGitHubConnection = {
  id: string;
  owner_user_id: string;
  workspace_id?: string | null;
  provider: "github_app" | "github_oauth";
  account_login: string;
  account_type?: "User" | "Organization" | null;
  installation_id?: string | null;
  scopes?: string[];
  status: "active" | "revoked" | "needs_reauth";
  created_at?: string;
  updated_at?: string;
};

export type DbGitHubUserToken = {
  id: string;
  connection_id: string;
  owner_user_id: string;
  access_token: string;
  token_type?: string | null;
  expires_at?: string | null;
  refresh_token?: string | null;
  refresh_token_expires_at?: string | null;
  scopes?: string[];
  created_at?: string;
  updated_at?: string;
};

export type DbSourceConfig = {
  id: string;
  project_id: string;
  connection_id?: string | null;
  source_type: string;
  name: string;
  status: string;
  config?: JsonObject;
};

export type DbTrigger = {
  id: string;
  project_id: string;
  name: string;
  trigger_type: string;
  status: string;
  last_run_at?: string | null;
  config?: JsonObject;
};

export type DbUserPreference = {
  id: string;
  project_id: string;
  preferred_markets?: string[];
  preferred_buyers?: string[];
  risk_tolerance?: string;
  notes?: string | null;
};

export type DbPreferenceEvent = {
  id: string;
  project_id: string;
  user_preference_id?: string | null;
  event_type: string;
  opportunity_id?: string | null;
  mvp_build_id?: string | null;
  payload?: JsonObject;
  created_at?: string;
};

export type DbPipelineRun = {
  id: string;
  project_id?: string | null;
  research_brief_id?: string | null;
  run_type: string;
  status: string;
  trigger?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: JsonObject | null;
};

export type ResearchBriefReadiness = "needs_context" | "ready_for_research" | "approved" | "running" | "completed";

export type DbIdeaConversation = {
  id: string;
  project_id: string;
  user_id?: string | null;
  title: string;
  status: "active" | "brief_ready" | "researching" | "closed";
  created_at?: string;
  updated_at?: string;
};

export type DbIdeaMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: JsonObject | null;
  created_at?: string;
};

export type DbResearchBrief = {
  id: string;
  project_id: string;
  conversation_id?: string | null;
  status: ResearchBriefReadiness;
  hypothesis: string;
  target_users: string[];
  pain_area: string;
  constraints: string[];
  source_plan: string[];
  disqualifying_evidence: string[];
  mvp_boundaries: string[];
  user_taste_notes: string[];
  open_questions: string[];
  confidence?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type DbAgentTask = {
  id: string;
  project_id: string;
  pipeline_run_id?: string | null;
  research_brief_id?: string | null;
  agent_role: string;
  status: "queued" | "running" | "completed" | "failed";
  prompt?: string | null;
  result?: JsonObject | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DbSignal = {
  id: string;
  project_id?: string | null;
  source?: string | null;
  title?: string | null;
  body?: string | null;
  url?: string | null;
};

export type DbOpportunity = {
  id: string;
  project_id?: string | null;
  pipeline_run_id?: string | null;
  title?: string | null;
  problem?: string | null;
  target_user?: string | null;
  mvp_concept?: string | null;
  score?: number | string | null;
  score_rationale?: string | null;
  status?: string | null;
  profile?: JsonObject | null;
  created_at?: string;
  updated_at?: string;
};

export type DbOpportunitySignal = {
  opportunity_id: string;
  signal_id: string;
};

export type DbEvaluation = {
  id?: string;
  opportunity_id?: string | null;
  evaluator?: string | null;
  content?: string | null;
  scores?: JsonObject | null;
};

export type DbPrototype = {
  id: string;
  project_id?: string | null;
  opportunity_id?: string | null;
  title?: string | null;
  prototype_type?: string | null;
  summary?: string | null;
  status?: string | null;
  artifact_url?: string | null;
  artifact_payload?: JsonObject | null;
};

export type DbMvpBuild = {
  id: string;
  project_id?: string | null;
  opportunity_id?: string | null;
  status?: string | null;
  pr_url?: string | null;
  generated_repo_url?: string | null;
  branch?: string | null;
  logs?: string | null;
  build_brief?: JsonObject | null;
  template_repo_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DbBuildArtifact = {
  id: string;
  mvp_build_id: string;
  artifact_type: string;
  content?: string | null;
  url?: string | null;
  metadata?: JsonObject | null;
};

export type DbReflectionRun = {
  id: string;
  project_id?: string | null;
  status: string;
  summary?: string | null;
  evidence?: JsonObject | null;
  created_at?: string;
  completed_at?: string | null;
};

export type DbReflectionProposal = {
  id: string;
  reflection_run_id: string;
  proposal_type: string;
  risk_level: string;
  title: string;
  rationale?: string | null;
  patch?: JsonObject | null;
  status: string;
};

export type ForgeStore = {
  users: DbUser[];
  workspaces: DbWorkspace[];
  workspace_members: DbWorkspaceMember[];
  user_auth_identities: DbUserAuthIdentity[];
  projects: DbProject[];
  github_connections: DbGitHubConnection[];
  github_user_tokens: DbGitHubUserToken[];
  source_configs: DbSourceConfig[];
  triggers: DbTrigger[];
  user_preferences: DbUserPreference[];
  preference_events: DbPreferenceEvent[];
  pipeline_runs: DbPipelineRun[];
  idea_conversations: DbIdeaConversation[];
  idea_messages: DbIdeaMessage[];
  research_briefs: DbResearchBrief[];
  agent_tasks: DbAgentTask[];
  signals: DbSignal[];
  opportunities: DbOpportunity[];
  opportunity_signals: DbOpportunitySignal[];
  opportunity_evaluations: DbEvaluation[];
  prototype_options: DbPrototype[];
  mvp_builds: DbMvpBuild[];
  build_artifacts: DbBuildArtifact[];
  reflection_runs: DbReflectionRun[];
  reflection_proposals: DbReflectionProposal[];
};

export type ForgeDbBackend = "supabase" | "local";
