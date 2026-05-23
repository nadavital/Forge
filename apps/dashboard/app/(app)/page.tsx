import { redirect } from "next/navigation";
import { loadDashboardProjects } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await loadDashboardProjects();

  if (projects.length === 0) {
    redirect("/projects/new");
  }

  const first = projects.find((project) => project.opportunities.length > 0) ?? projects[0];
  redirect(`/projects/${first.id}`);
}
