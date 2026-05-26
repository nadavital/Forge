import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { loadAuthSessionView, loadDashboardProjects } from "@/lib/dashboard-data";
import { ProjectsProvider } from "@/lib/projects-context";
import { isHostedAuthRequired } from "@/lib/auth/supabase-auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const authSession = await loadAuthSessionView();
  if (isHostedAuthRequired() && !authSession.signedIn) {
    redirect("/login");
  }
  const projects = await loadDashboardProjects();

  return (
    <ProjectsProvider projects={projects}>
      <AppShell authSession={authSession}>{children}</AppShell>
    </ProjectsProvider>
  );
}
