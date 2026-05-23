import { AppShell } from "@/components/shell/AppShell";
import { loadDashboardProjects } from "@/lib/dashboard-data";
import { ProjectsProvider } from "@/lib/projects-context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const projects = await loadDashboardProjects();

  return (
    <ProjectsProvider projects={projects}>
      <AppShell>{children}</AppShell>
    </ProjectsProvider>
  );
}
