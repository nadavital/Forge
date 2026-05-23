import { loadForgeProject, loadForgeProjects } from "@/lib/forge-data";
import { getProjectBundle, loadStore } from "@/lib/db/repository";
import { buildOnboardingChecklist, onboardingStatus } from "@/lib/project-onboarding";
import { isDueProjectTrigger } from "@/lib/scheduler/demo-scheduler";
import type { MorningReviewProject, ProjectSettingsView, SchedulerOverview } from "@/types/forge";

export async function loadDashboardProjects() {
  return loadForgeProjects();
}

export async function loadSchedulerOverview(projectId?: string): Promise<SchedulerOverview> {
  const store = await loadStore();
  const scheduleTriggers = store.triggers.filter(
    (trigger) => trigger.trigger_type !== "manual" && (!projectId || trigger.project_id === projectId)
  );
  const active = scheduleTriggers.filter((trigger) => trigger.status === "active");
  const due = active.filter((trigger) => isDueProjectTrigger(trigger));
  const lastRunAt = scheduleTriggers
    .map((trigger) => trigger.last_run_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    activeCount: active.length,
    dueCount: due.length,
    lastRunAt
  };
}

export async function loadDashboardProject(projectId: string) {
  return loadForgeProject(projectId);
}

export async function loadDashboardOpportunity(projectId: string, opportunityId: string) {
  const project = await loadDashboardProject(projectId);
  if (!project) {
    return null;
  }
  const opportunity = project.opportunities.find((entry) => entry.id === opportunityId);
  return opportunity ? { project, opportunity } : null;
}

export async function loadProjectSettings(projectId: string): Promise<ProjectSettingsView | null> {
  const bundle = await getProjectBundle(projectId);
  if (!bundle.project) {
    return null;
  }
  const checklist = buildOnboardingChecklist({
    project: bundle.project,
    sources: bundle.sources,
    triggers: bundle.triggers,
    preference: bundle.preferences
  });

  return {
    project: {
      repoUrl: bundle.project.repo_url || "",
      productUrl: bundle.project.product_url || "",
      description: bundle.project.description || ""
    },
    onboarding: {
      status: onboardingStatus(checklist),
      checklist
    },
    sources: bundle.sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.source_type,
      status: source.status
    })),
    triggers: bundle.triggers.map((trigger) => ({
      id: trigger.id,
      name: trigger.name,
      type: trigger.trigger_type,
      status: trigger.status,
      lastRunAt: trigger.last_run_at
    })),
    preferences: {
      riskTolerance: bundle.preferences?.risk_tolerance || "medium",
      markets: bundle.preferences?.preferred_markets || [],
      notes: bundle.preferences?.notes || ""
    }
  };
}

export async function loadDashboardProjectWithMeta(projectId: string): Promise<MorningReviewProject | null> {
  return loadForgeProject(projectId);
}
