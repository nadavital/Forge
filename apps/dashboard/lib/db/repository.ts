import { newId, readLocalStore, writeLocalStore } from "@/lib/db/local-db";
import { createPrototypeOptionDraft } from "@/lib/prototypes/prototype-options";
import { createSupabaseClient, isSupabaseConfigured } from "@/lib/db/supabase";
import { buildProjectDefaults, githubSourcePatch, normalizeGithubRepository } from "@/lib/project-onboarding";
import type {
  DbBuildArtifact,
  DbEvaluation,
  DbMvpBuild,
  DbOpportunity,
  DbOpportunitySignal,
  DbPipelineRun,
  DbPreferenceEvent,
  DbProject,
  DbReflectionRun,
  DbReflectionProposal,
  DbSignal,
  DbSourceConfig,
  DbTrigger,
  DbUserPreference,
  ForgeDbBackend,
  ForgeStore,
  JsonObject
} from "@/lib/db/types";
import type { ProjectMode } from "@/types/forge";

export function getDbBackend(): ForgeDbBackend {
  return isSupabaseConfigured() ? "supabase" : "local";
}

export async function loadStore(): Promise<ForgeStore> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return readLocalStore();
  }

  const tables = [
    "projects",
    "source_configs",
    "triggers",
    "user_preferences",
    "preference_events",
    "pipeline_runs",
    "signals",
    "opportunities",
    "opportunity_signals",
    "opportunity_evaluations",
    "prototype_options",
    "mvp_builds",
    "build_artifacts",
    "reflection_runs",
    "reflection_proposals"
  ] as const;

  const entries = await Promise.all(
    tables.map(async (table) => {
      try {
        const rows = await supabase.select(table, "select=*");
        return [table, rows] as const;
      } catch {
        return [table, []] as const;
      }
    })
  );

  const store = Object.fromEntries(entries) as ForgeStore;
  if (store.projects.length === 0) {
    return readLocalStore();
  }
  return store;
}

async function mutateStore(mutator: (store: ForgeStore) => void): Promise<ForgeStore> {
  if (isSupabaseConfigured()) {
    throw new Error("Direct store mutation is only supported on the local backend.");
  }

  const store = await readLocalStore();
  mutator(store);
  await writeLocalStore(store);
  return store;
}

export async function createProjectRecord(input: {
  name: string;
  mode: ProjectMode;
  repoUrl?: string | null;
  productUrl?: string;
  description?: string;
  markets?: string[];
  riskTolerance?: string;
  notes?: string;
  scheduleCadence?: string;
}): Promise<DbProject> {
  const now = new Date().toISOString();
  const defaults = buildProjectDefaults({
    projectId: newId("proj"),
    mode: input.mode,
    name: input.name,
    repoUrl: input.repoUrl,
    productUrl: input.productUrl,
    description: input.description,
    markets: input.markets,
    riskTolerance: input.riskTolerance,
    notes: input.notes,
    scheduleCadence: input.scheduleCadence,
    now,
    idFactory: newId
  });

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const project = await supabase.insert("projects", defaults.project);
    for (const source of defaults.sources) {
      await supabase.insert("source_configs", { ...source, project_id: project.id });
    }
    for (const trigger of defaults.triggers) {
      await supabase.insert("triggers", { ...trigger, project_id: project.id });
    }
    await supabase.insert("user_preferences", { ...defaults.preference, project_id: project.id });
    return project;
  }

  await mutateStore((store) => {
    store.projects.unshift(defaults.project);
    store.source_configs.push(...defaults.sources);
    store.triggers.push(...defaults.triggers);
    store.user_preferences.push(defaults.preference);
  });

  return defaults.project;
}

export async function updateProjectRepository(input: {
  projectId: string;
  repoUrl: string;
  productContext?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const githubPatch = githubSourcePatch(input.repoUrl);
  const normalizedRepoUrl = normalizeGithubRepository(input.repoUrl)?.repoUrl ?? input.repoUrl;
  const patch = {
    repo_url: normalizedRepoUrl,
    description: input.productContext,
    updated_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("projects", input.projectId, patch);
    if (githubPatch) {
      const githubSources = await supabase.select<DbSourceConfig>(
        "source_configs",
        `select=*&project_id=eq.${encodeURIComponent(input.projectId)}&source_type=eq.github&limit=1`
      );
      const source = githubSources[0];
      if (source) {
        await supabase.update("source_configs", source.id, githubPatch);
      } else {
        await supabase.insert("source_configs", {
          id: newId("src"),
          project_id: input.projectId,
          source_type: "github",
          ...githubPatch
        });
      }
    }
    return;
  }

  await mutateStore((store) => {
    const project = store.projects.find((row) => row.id === input.projectId);
    if (project) {
      project.repo_url = normalizedRepoUrl;
      project.description = input.productContext ?? project.description;
      project.updated_at = now;
    }
    const source = store.source_configs.find(
      (row) => row.project_id === input.projectId && row.source_type === "github"
    );
    if (source) {
      source.status = "active";
      source.config = { ...(source.config ?? {}), repo_url: normalizedRepoUrl };
      if (githubPatch) {
        Object.assign(source, githubPatch);
      }
    } else {
      store.source_configs.push({
        id: newId("src"),
        project_id: input.projectId,
        source_type: "github",
        name: githubPatch?.name ?? "GitHub issues",
        status: "active",
        config: githubPatch?.config ?? { repo_url: normalizedRepoUrl }
      });
    }
  });
}

export async function replaceProjectDiscoveryRecords(input: {
  projectId: string;
  runId: string;
  signals: Array<Omit<DbSignal, "id" | "project_id"> & { id?: string }>;
  opportunities: Array<
    Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
      id?: string;
      signalIndexes: number[];
      evaluations?: Array<Omit<DbEvaluation, "id" | "opportunity_id">>;
    }
  >;
}): Promise<void> {
  const now = new Date().toISOString();
  const signalRows: DbSignal[] = input.signals.map((signal) => ({
    id: signal.id ?? newId("sig"),
    project_id: input.projectId,
    source: signal.source,
    title: signal.title,
    body: signal.body,
    url: signal.url
  }));

  const opportunityRows: DbOpportunity[] = input.opportunities.map((opportunity) => ({
    id: opportunity.id ?? newId("opp"),
    project_id: input.projectId,
    pipeline_run_id: input.runId,
    title: opportunity.title,
    problem: opportunity.problem,
    target_user: opportunity.target_user,
    mvp_concept: opportunity.mvp_concept,
    score: opportunity.score,
    score_rationale: opportunity.score_rationale,
    status: opportunity.status ?? "proposed",
    profile: opportunity.profile,
    created_at: now,
    updated_at: now
  }));

  const links: DbOpportunitySignal[] = input.opportunities.flatMap((opportunity, opportunityIndex) =>
    opportunity.signalIndexes
      .map((signalIndex) => signalRows[signalIndex])
      .filter((signal): signal is DbSignal => Boolean(signal))
      .map((signal) => ({
        opportunity_id: opportunityRows[opportunityIndex].id,
        signal_id: signal.id
      }))
  );

  const evaluations: DbEvaluation[] = input.opportunities.flatMap((opportunity, opportunityIndex) =>
    (opportunity.evaluations ?? []).map((evaluation) => ({
      id: newId("eval"),
      opportunity_id: opportunityRows[opportunityIndex].id,
      evaluator: evaluation.evaluator,
      content: evaluation.content,
      scores: evaluation.scores
    }))
  );
  const prototypeRows = opportunityRows.map((opportunity) => ({
    id: newId("proto"),
    project_id: input.projectId,
    opportunity_id: opportunity.id,
    prototype_type: "clickable_demo",
    ...createPrototypeOptionDraft(opportunity)
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const oldOpportunities = await supabase.select<DbOpportunity>(
      "opportunities",
      `select=id&project_id=eq.${encodeURIComponent(input.projectId)}&pipeline_run_id=not.is.null`
    );
    const oldOpportunityIds = oldOpportunities.map((opportunity) => opportunity.id);
    if (oldOpportunityIds.length > 0) {
      const oldOpportunityFilter = `(${oldOpportunityIds.join(",")})`;
      const oldBuilds = await supabase.select<DbMvpBuild>(
        "mvp_builds",
        `select=id&opportunity_id=in.${oldOpportunityFilter}`
      );
      const oldBuildIds = oldBuilds.map((build) => build.id);
      if (oldBuildIds.length > 0) {
        await supabase.delete("build_artifacts", `mvp_build_id=in.(${oldBuildIds.join(",")})`);
        await supabase.delete("mvp_builds", `id=in.(${oldBuildIds.join(",")})`);
      }
      await supabase.delete("prototype_options", `opportunity_id=in.${oldOpportunityFilter}`);
      await supabase.delete("opportunity_evaluations", `opportunity_id=in.${oldOpportunityFilter}`);
      await supabase.delete("opportunity_signals", `opportunity_id=in.${oldOpportunityFilter}`);
      await supabase.delete("opportunities", `id=in.${oldOpportunityFilter}`);
    }
    await supabase.delete("signals", `project_id=eq.${encodeURIComponent(input.projectId)}`);
    for (const signal of signalRows) await supabase.insert("signals", signal);
    for (const opportunity of opportunityRows) await supabase.insert("opportunities", opportunity);
    for (const link of links) await supabase.insert("opportunity_signals", link);
    for (const evaluation of evaluations) await supabase.insert("opportunity_evaluations", evaluation);
    for (const prototype of prototypeRows) await supabase.insert("prototype_options", prototype);
    return;
  }

  await mutateStore((store) => {
    const oldOpportunityIds = new Set(
      store.opportunities
        .filter((row) => row.project_id === input.projectId && row.pipeline_run_id)
        .map((row) => row.id)
    );
    const oldSignalIds = new Set(
      store.signals.filter((row) => row.project_id === input.projectId).map((row) => row.id)
    );

    store.build_artifacts = store.build_artifacts.filter((artifact) =>
      store.mvp_builds.some(
        (build) => build.id === artifact.mvp_build_id && !oldOpportunityIds.has(build.opportunity_id ?? "")
      )
    );
    store.mvp_builds = store.mvp_builds.filter((build) => !oldOpportunityIds.has(build.opportunity_id ?? ""));
    store.prototype_options = store.prototype_options.filter(
      (prototype) => !oldOpportunityIds.has(prototype.opportunity_id ?? "")
    );
    store.opportunity_evaluations = store.opportunity_evaluations.filter(
      (evaluation) => !oldOpportunityIds.has(evaluation.opportunity_id ?? "")
    );
    store.opportunity_signals = store.opportunity_signals.filter(
      (link) => !oldOpportunityIds.has(link.opportunity_id) && !oldSignalIds.has(link.signal_id)
    );
    store.opportunities = store.opportunities.filter((row) => !oldOpportunityIds.has(row.id));
    store.signals = store.signals.filter((row) => !oldSignalIds.has(row.id));

    store.signals.unshift(...signalRows);
    store.opportunities.unshift(...opportunityRows);
    store.opportunity_signals.unshift(...links);
    store.opportunity_evaluations.unshift(...evaluations);
    store.prototype_options.unshift(...prototypeRows);
  });
}

export async function recordPreferenceEvent(input: {
  projectId: string;
  eventType: string;
  opportunityId?: string;
  mvpBuildId?: string;
  payload?: JsonObject;
}): Promise<DbPreferenceEvent> {
  const event: DbPreferenceEvent = {
    id: newId("evt"),
    project_id: input.projectId,
    opportunity_id: input.opportunityId,
    event_type: input.eventType,
    mvp_build_id: input.mvpBuildId,
    payload: input.payload ?? {},
    created_at: new Date().toISOString()
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return supabase.insert("preference_events", event);
  }

  await mutateStore((store) => {
    store.preference_events.unshift(event);
    if (!input.opportunityId) {
      return;
    }
    const opportunity = store.opportunities.find((row) => row.id === input.opportunityId);
    if (opportunity) {
      if (input.eventType === "approved") opportunity.status = "building";
      if (input.eventType === "rejected") opportunity.status = "rejected";
      if (input.eventType === "ignored") opportunity.status = "watching";
      if (input.eventType === "feedback") opportunity.status = "researching";
    }
  });

  return event;
}

export async function updateOpportunityStatus(opportunityId: string, status: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("opportunities", opportunityId, { status, updated_at: new Date().toISOString() });
    return;
  }

  await mutateStore((store) => {
    const opportunity = store.opportunities.find((row) => row.id === opportunityId);
    if (opportunity) {
      opportunity.status = status;
    }
  });
}

export async function createMvpBuild(input: {
  projectId: string;
  opportunityId: string;
  buildBrief: JsonObject;
}): Promise<DbMvpBuild> {
  const now = new Date().toISOString();
  const build: DbMvpBuild = {
    id: newId("build"),
    project_id: input.projectId,
    opportunity_id: input.opportunityId,
    status: "queued",
    build_brief: input.buildBrief,
    template_repo_url: "https://github.com/forge-labs/mvp-template",
    created_at: now,
    updated_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return supabase.insert("mvp_builds", build);
  }

  await mutateStore((store) => {
    store.mvp_builds.unshift(build);
  });

  return build;
}

export async function createReflectionRun(input: {
  projectId: string;
  summary: string;
  evidence: JsonObject;
  proposals: Array<Omit<DbReflectionProposal, "id" | "reflection_run_id" | "status">>;
}): Promise<DbReflectionRun> {
  const now = new Date().toISOString();
  const run: DbReflectionRun = {
    id: newId("refl_run"),
    project_id: input.projectId,
    status: "completed",
    summary: input.summary,
    evidence: input.evidence,
    created_at: now,
    completed_at: now
  };
  const proposals: DbReflectionProposal[] = input.proposals.map((proposal) => ({
    id: newId("refl_prop"),
    reflection_run_id: run.id,
    proposal_type: proposal.proposal_type,
    risk_level: proposal.risk_level,
    title: proposal.title,
    rationale: proposal.rationale,
    patch: proposal.patch,
    status: "proposed"
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const insertedRun = await supabase.insert("reflection_runs", run);
    for (const proposal of proposals) {
      await supabase.insert("reflection_proposals", proposal);
    }
    return insertedRun;
  }

  await mutateStore((store) => {
    store.reflection_runs.unshift(run);
    store.reflection_proposals.unshift(...proposals);
  });

  return run;
}

export async function updateMvpBuild(buildId: string, patch: Partial<DbMvpBuild>): Promise<DbMvpBuild> {
  const payload = { ...patch, updated_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return (await supabase.update<Partial<DbMvpBuild>>("mvp_builds", buildId, payload)) as DbMvpBuild;
  }

  await mutateStore((store) => {
    const index = store.mvp_builds.findIndex((row) => row.id === buildId);
    if (index >= 0) {
      store.mvp_builds[index] = { ...store.mvp_builds[index], ...payload };
    }
  });

  const store = await readLocalStore();
  return (store.mvp_builds.find((row) => row.id === buildId) ?? { id: buildId, ...payload }) as DbMvpBuild;
}

export async function insertBuildArtifacts(
  buildId: string,
  artifacts: Array<Omit<DbBuildArtifact, "id" | "mvp_build_id">>
): Promise<DbBuildArtifact[]> {
  const rows = artifacts.map((artifact) => ({
    id: newId("art"),
    mvp_build_id: buildId,
    ...artifact
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const inserted: DbBuildArtifact[] = [];
    for (const row of rows) {
      inserted.push(await supabase.insert("build_artifacts", row));
    }
    return inserted;
  }

  await mutateStore((store) => {
    store.build_artifacts.unshift(...rows);
  });

  return rows;
}

export async function createPipelineRun(projectId: string): Promise<DbPipelineRun> {
  const now = new Date().toISOString();
  const run: DbPipelineRun = {
    id: newId("run"),
    project_id: projectId,
    run_type: "managed",
    status: "running",
    trigger: "manual",
    started_at: now,
    metadata: { source: "dashboard" }
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return supabase.insert("pipeline_runs", run);
  }

  await mutateStore((store) => {
    store.pipeline_runs.unshift(run);
  });

  return run;
}

export async function completePipelineRun(runId: string, metadata: JsonObject): Promise<void> {
  const patch = {
    status: "completed",
    completed_at: new Date().toISOString(),
    metadata
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("pipeline_runs", runId, patch);
    return;
  }

  await mutateStore((store) => {
    const run = store.pipeline_runs.find((row) => row.id === runId);
    if (run) {
      Object.assign(run, patch);
    }
  });
}

export async function updateProjectSettings(input: {
  projectId: string;
  project: Pick<DbProject, "repo_url" | "product_url" | "description">;
  preferences: Pick<DbUserPreference, "preferred_markets" | "risk_tolerance" | "notes">;
  sources: Array<Pick<DbSourceConfig, "id" | "status">>;
  triggers: Array<Pick<DbTrigger, "id" | "status"> & { config?: JsonObject }>;
}): Promise<void> {
  const githubPatch = githubSourcePatch(input.project.repo_url);
  const normalizedRepo = normalizeGithubRepository(input.project.repo_url);
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("projects", input.projectId, {
      repo_url: normalizedRepo?.repoUrl ?? null,
      product_url: input.project.product_url,
      description: input.project.description,
      updated_at: now
    });
    const pref = (
      await supabase.select<DbUserPreference>(
        "user_preferences",
        `select=*&project_id=eq.${encodeURIComponent(input.projectId)}&limit=1`
      )
    )[0];
    if (pref) {
      await supabase.update("user_preferences", pref.id, {
        ...input.preferences,
        updated_at: new Date().toISOString()
      });
    }
    for (const source of input.sources) {
      await supabase.update("source_configs", source.id, { status: source.status });
    }
    if (githubPatch) {
      const githubSources = await supabase.select<DbSourceConfig>(
        "source_configs",
        `select=*&project_id=eq.${encodeURIComponent(input.projectId)}&source_type=eq.github&limit=1`
      );
      const source = githubSources[0];
      if (source) {
        await supabase.update("source_configs", source.id, githubPatch);
      } else {
        await supabase.insert("source_configs", {
          id: newId("src"),
          project_id: input.projectId,
          source_type: "github",
          ...githubPatch
        });
      }
    }
    for (const trigger of input.triggers) {
      await supabase.update("triggers", trigger.id, {
        status: trigger.status,
        ...(trigger.config ? { config: trigger.config } : {})
      });
    }
    return;
  }

  await mutateStore((store) => {
    const project = store.projects.find((row) => row.id === input.projectId);
    if (project) {
      project.repo_url = normalizedRepo?.repoUrl ?? null;
      project.product_url = input.project.product_url;
      project.description = input.project.description;
      project.updated_at = now;
    }

    const pref = store.user_preferences.find((row) => row.project_id === input.projectId);
    if (pref) {
      pref.preferred_markets = input.preferences.preferred_markets;
      pref.risk_tolerance = input.preferences.risk_tolerance;
      pref.notes = input.preferences.notes;
    }
    for (const source of input.sources) {
      const row = store.source_configs.find((entry) => entry.id === source.id);
      if (row) row.status = source.status;
    }
    if (githubPatch) {
      const githubSource = store.source_configs.find(
        (source) => source.project_id === input.projectId && source.source_type === "github"
      );
      if (githubSource) {
        Object.assign(githubSource, githubPatch);
      } else {
        store.source_configs.push({
          id: newId("src"),
          project_id: input.projectId,
          source_type: "github",
          ...githubPatch
        });
      }
    }
    for (const trigger of input.triggers) {
      const row = store.triggers.find((entry) => entry.id === trigger.id);
      if (row) {
        row.status = trigger.status;
        if (trigger.config) {
          row.config = { ...(row.config ?? {}), ...trigger.config };
        }
      }
    }
  });
}

export async function markTriggerRan(triggerId: string): Promise<void> {
  const patch = { last_run_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("triggers", triggerId, patch);
    return;
  }

  await mutateStore((store) => {
    const trigger = store.triggers.find((row) => row.id === triggerId);
    if (trigger) {
      trigger.last_run_at = patch.last_run_at;
    }
  });
}

export async function archiveProjectRecord(projectId: string): Promise<void> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("projects", projectId, {
      archived_at: now,
      stage: "archived",
      updated_at: now
    });
    return;
  }

  await mutateStore((store) => {
    const project = store.projects.find((row) => row.id === projectId);
    if (!project) {
      return;
    }
    project.archived_at = now;
    project.stage = "archived";
    project.updated_at = now;
    for (const trigger of store.triggers.filter((row) => row.project_id === projectId)) {
      trigger.status = "disabled";
    }
    store.preference_events.unshift({
      id: newId("evt"),
      project_id: projectId,
      event_type: "project_archived",
      payload: { archived_at: now },
      created_at: now
    });
  });
}

export async function resolveReflectionProposal(proposalId: string, decision: "accepted" | "rejected"): Promise<void> {
  const patch = { status: decision, updated_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("reflection_proposals", proposalId, patch);
    return;
  }

  await mutateStore((store) => {
    const proposal = store.reflection_proposals.find((row) => row.id === proposalId);
    if (proposal) {
      proposal.status = decision;
    }
  });
}

export async function getProjectBundle(projectId: string, store?: ForgeStore) {
  const data = store ?? (await loadStore());

  return {
    project: data.projects.find((row) => row.id === projectId),
    sources: data.source_configs.filter((row) => row.project_id === projectId),
    triggers: data.triggers.filter((row) => row.project_id === projectId),
    preferences: data.user_preferences.find((row) => row.project_id === projectId),
    runs: data.pipeline_runs.filter((row) => row.project_id === projectId),
    opportunities: data.opportunities.filter((row) => row.project_id === projectId),
    signals: data.signals.filter((row) => row.project_id === projectId),
    links: data.opportunity_signals,
    evaluations: data.opportunity_evaluations,
    prototypes: data.prototype_options.filter((row) => row.project_id === projectId),
    builds: data.mvp_builds.filter((row) => row.project_id === projectId),
    artifacts: data.build_artifacts,
    reflectionRuns: data.reflection_runs.filter((row) => row.project_id === projectId),
    reflectionProposals: data.reflection_proposals.filter((proposal) =>
      data.reflection_runs.some((run) => run.project_id === projectId && run.id === proposal.reflection_run_id)
    ),
    preferenceEvents: data.preference_events.filter((row) => row.project_id === projectId)
  };
}

export async function getOpportunityRecord(opportunityId: string, store?: ForgeStore): Promise<DbOpportunity | undefined> {
  const data = store ?? (await loadStore());
  return data.opportunities.find((row) => row.id === opportunityId);
}

export async function getForgeSettingsView() {
  const store = await loadStore();
  const proposals = store.reflection_proposals.filter((row) => row.status === "proposed");

  return {
    builder:
      process.env.FORGE_BUILDER_ADAPTER === "managed" || process.env.GEMINI_API_KEY
        ? "Gemini managed builder"
        : isSupabaseConfigured()
          ? "Supabase-backed simulated adapter"
          : "Local simulated adapter",
    humanGate: "Opportunity approval required",
    guardrails: ["Free services only", "Template repo", "PR-ready MVP", "No production deploys"],
    reflectionProposals: proposals
  };
}

function cleanOptional(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
