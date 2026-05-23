import { notFound } from "next/navigation";
import { ProjectHeader } from "@/components/projects/ProjectHeader";
import { ProjectSettingsForm } from "@/components/settings/ProjectSettingsForm";
import { ReflectionPanel } from "@/components/settings/ReflectionPanel";
import { loadDashboardProject, loadProjectSettings } from "@/lib/dashboard-data";
import { loadReflectionProposals } from "@/lib/forge-data";

type ProjectSettingsPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ welcome?: string }>;
};

export default async function ProjectSettingsPage({ params, searchParams }: ProjectSettingsPageProps) {
  const { projectId } = await params;
  const { welcome } = await searchParams;
  const [project, settings, proposals] = await Promise.all([
    loadDashboardProject(projectId),
    loadProjectSettings(projectId),
    loadReflectionProposals(projectId)
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
        <ProjectSettingsForm projectId={project.id} settings={settings} />
        <ReflectionPanel proposals={proposals} />
      </div>
    </main>
  );
}
