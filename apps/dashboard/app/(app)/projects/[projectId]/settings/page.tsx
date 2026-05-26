import { notFound } from "next/navigation";
import { GitHubConnectionPanel } from "@/components/settings/GitHubConnectionPanel";
import { ProjectHeader } from "@/components/projects/ProjectHeader";
import { SchedulerControl } from "@/components/projects/SchedulerControl";
import { ProjectSettingsForm } from "@/components/settings/ProjectSettingsForm";
import { ReflectionPanel } from "@/components/settings/ReflectionPanel";
import { RuntimeReadinessPanel } from "@/components/settings/RuntimeReadinessPanel";
import { loadDashboardProject, loadProjectSettings, loadSchedulerOverview } from "@/lib/dashboard-data";
import { loadReflectionProposals } from "@/lib/forge-data";

export const dynamic = "force-dynamic";

type ProjectSettingsPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    welcome?: string;
    github?: string;
    github_account?: string;
    github_message?: string;
    github_provider?: string;
  }>;
};

export default async function ProjectSettingsPage({ params, searchParams }: ProjectSettingsPageProps) {
  const { projectId } = await params;
  const { welcome, github, github_account, github_message, github_provider } = await searchParams;
  const [project, settings, proposals, scheduler] = await Promise.all([
    loadDashboardProject(projectId),
    loadProjectSettings(projectId),
    loadReflectionProposals(projectId),
    loadSchedulerOverview(projectId)
  ]);

  if (!project || !settings) {
    notFound();
  }

  return (
    <main className="page page-narrow">
      <ProjectHeader
        mode={project.mode}
        projectId={project.id}
        projectName={project.name}
        runStatus={project.runStatus}
      />

      {welcome ? (
        <div className="welcome-banner" role="status">
          Project created. Connect sources and set taste before your first run.
        </div>
      ) : null}

      {github === "connected" ? (
        <div className="welcome-banner" role="status">
          {github_provider === "oauth" ? "GitHub user authorized" : "GitHub App connected"}
          {github_account ? ` for ${github_account}` : ""}. Choose a repository below.
        </div>
      ) : null}

      {github === "error" ? (
        <div className="welcome-banner warning" role="status">
          GitHub connection was not saved{github_message ? `: ${github_message}` : "."}
        </div>
      ) : null}

      <div className="settings-stack">
        <RuntimeReadinessPanel items={settings.runtimeReadiness} />
        <SchedulerControl overview={scheduler} projectId={project.id} />
        <GitHubConnectionPanel projectId={project.id} settings={settings} />
        <ProjectSettingsForm projectId={project.id} settings={settings} />
        <ReflectionPanel projectId={project.id} proposals={proposals} />
      </div>
    </main>
  );
}
