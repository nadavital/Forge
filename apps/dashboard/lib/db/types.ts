export type JsonObject = Record<string, unknown>;

export type DbProject = {
  id: string;
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

export type DbSourceConfig = {
  id: string;
  project_id: string;
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
  run_type: string;
  status: string;
  trigger?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: JsonObject | null;
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
  status?: string | null;
  artifact_url?: string | null;
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
  status: string;
};

export type ForgeStore = {
  projects: DbProject[];
  source_configs: DbSourceConfig[];
  triggers: DbTrigger[];
  user_preferences: DbUserPreference[];
  preference_events: DbPreferenceEvent[];
  pipeline_runs: DbPipelineRun[];
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
