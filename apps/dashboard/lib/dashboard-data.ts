import { loadForgeProject, loadForgeProjects } from "@/lib/forge-data";
import { getProjectBundle } from "@/lib/db/repository";
import { buildOnboardingChecklist, onboardingStatus } from "@/lib/project-onboarding";
import type { MorningReviewProject, ProjectSettingsView } from "@/types/forge";

export async function loadDashboardProjects() {
  return loadForgeProjects();
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
      status: trigger.status
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
