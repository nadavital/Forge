import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { SchedulerControl } from "@/components/projects/SchedulerControl";
import { loadDashboardProjects, loadSchedulerOverview } from "@/lib/dashboard-data";
import { plural } from "@/lib/decision";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [projects, scheduler] = await Promise.all([loadDashboardProjects(), loadSchedulerOverview()]);

  const totalOpportunities = projects.reduce((count, project) => count + project.opportunities.length, 0);
  const activeBuilds = projects.reduce(
    (count, project) =>
      count +
      project.opportunities.filter(
        (opportunity) => opportunity.build && !["completed", "failed"].includes(opportunity.build.status)
      ).length,
    0
  );

  return (
    <main className="page">
      <header className="overview-header">
        <div>
          <h1>Projects</h1>
          <p>One place to check what Forge knows, what is ready to review, and where to create the next project.</p>
        </div>
        <Link className="btn btn-primary" href="/projects/new">
          <Plus aria-hidden="true" />
          New project
        </Link>
      </header>

      <section aria-label="Workspace summary" className="overview-strip">
        <div>
          <strong>{projects.length}</strong>
          <span>{plural(projects.length, "project")}</span>
        </div>
        <div>
          <strong>{totalOpportunities}</strong>
          <span>{plural(totalOpportunities, "opportunity", "opportunities")}</span>
        </div>
        <div>
          <strong>{activeBuilds}</strong>
          <span>{plural(activeBuilds, "active build")}</span>
        </div>
      </section>

      <SchedulerControl overview={scheduler} />

      {projects.length === 0 ? (
        <section className="empty-panel">
          <h2>No projects yet</h2>
          <p>Add an existing GitHub repo or start a new product idea to create real project records.</p>
          <Link className="btn btn-primary" href="/projects/new">
            <Plus aria-hidden="true" />
            Create project
          </Link>
        </section>
      ) : (
        <section aria-labelledby="projects-heading" className="project-overview">
          <div className="section-head">
            <h2 id="projects-heading">All projects</h2>
          </div>
          <div className="project-overview-list">
            {projects.map((project) => {
              const topOpportunity = project.opportunities[0];

              return (
                <Link className="project-overview-row" href={`/projects/${project.id}`} key={project.id}>
                  <div>
                    <h3>{project.name}</h3>
                    <p>{topOpportunity?.title ?? "No opportunities recorded yet."}</p>
                  </div>
                  <div className="project-overview-meta">
                    <span>{project.mode}</span>
                    <span>{plural(project.opportunities.length, "opportunity", "opportunities")}</span>
                    <ArrowUpRight aria-hidden="true" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
