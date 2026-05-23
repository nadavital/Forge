import { notFound } from "next/navigation";
import { ProjectHeader } from "@/components/projects/ProjectHeader";
import { SchedulerControl } from "@/components/projects/SchedulerControl";
import { ProjectSettingsForm } from "@/components/settings/ProjectSettingsForm";
import { ReflectionPanel } from "@/components/settings/ReflectionPanel";
import { loadDashboardProject, loadProjectSettings, loadSchedulerOverview } from "@/lib/dashboard-data";
import { loadReflectionProposals } from "@/lib/forge-data";

export const dynamic = "force-dynamic";

type ProjectSettingsPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ welcome?: string }>;
};

export default async function ProjectSettingsPage({ params, searchParams }: ProjectSettingsPageProps) {
  const { projectId } = await params;
  const { welcome } = await searchParams;
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

      <div className="settings-stack">
        <SchedulerControl overview={scheduler} projectId={project.id} />
        <ProjectSettingsForm projectId={project.id} settings={settings} />
        <ReflectionPanel projectId={project.id} proposals={proposals} />
      </div>
    </main>
  );
}
