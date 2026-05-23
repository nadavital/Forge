import { newId, readLocalStore, writeLocalStore } from "@/lib/db/local-db";
import { createSupabaseClient, isSupabaseConfigured } from "@/lib/db/supabase";
import type {
  DbBuildArtifact,
  DbMvpBuild,
  DbOpportunity,
  DbPipelineRun,
  DbPreferenceEvent,
  DbProject,
  DbReflectionProposal,
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
}): Promise<DbProject> {
  const now = new Date().toISOString();
  const project: DbProject = {
    id: newId("proj"),
    name: input.name.trim(),
    mode: input.mode,
    stage: "idea",
    created_at: now,
    updated_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return supabase.insert("projects", project);
  }

  await mutateStore((store) => {
    store.projects.unshift(project);
    store.source_configs.push({
      id: newId("src"),
      project_id: project.id,
      source_type: input.mode === "connected_product" ? "github" : "manual",
      name: input.mode === "connected_product" ? "GitHub issues" : "Manual ideas",
      status: "active"
    });
    store.triggers.push({
      id: newId("trg"),
      project_id: project.id,
      name: "Manual",
      trigger_type: "manual",
      status: "active"
    });
    store.user_preferences.push({
      id: newId("pref"),
      project_id: project.id,
      preferred_markets: input.mode === "connected_product" ? ["Your product"] : ["New market"],
      risk_tolerance: input.mode === "connected_product" ? "medium" : "low",
      notes:
        input.mode === "connected_product"
          ? "Connect feedback and repo signals before the first scheduled run."
          : "Start with manual ideas and taste notes until the loop feels right."
    });
  });

  return project;
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
    run_type: "review",
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
  preferences: Pick<DbUserPreference, "preferred_markets" | "risk_tolerance" | "notes">;
  sources: Array<Pick<DbSourceConfig, "id" | "status">>;
  triggers: Array<Pick<DbTrigger, "id" | "status">>;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
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
    for (const trigger of input.triggers) {
      await supabase.update("triggers", trigger.id, { status: trigger.status });
    }
    return;
  }

  await mutateStore((store) => {
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
    for (const trigger of input.triggers) {
      const row = store.triggers.find((entry) => entry.id === trigger.id);
      if (row) row.status = trigger.status;
    }
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
    builder: isSupabaseConfigured() ? "Supabase-backed simulated adapter" : "Local simulated adapter",
    humanGate: "Opportunity approval required",
    guardrails: ["Free services only", "Template repo", "PR-ready MVP", "No production deploys"],
    reflectionProposals: proposals
  };
}
