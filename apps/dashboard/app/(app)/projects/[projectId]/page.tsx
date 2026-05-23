import { notFound } from "next/navigation";
import { OpportunityCard } from "@/components/opportunities/OpportunityCard";
import { ProjectHeader } from "@/components/projects/ProjectHeader";
import { loadDashboardProject } from "@/lib/dashboard-data";
import { plural } from "@/lib/decision";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const project = await loadDashboardProject(projectId);

  if (!project) {
    notFound();
  }

  return (
    <main className="page">
      <ProjectHeader
        mode={project.mode}
        opportunityCount={project.opportunities.length}
        projectId={project.id}
        projectName={project.name}
        runStatus={project.runStatus}
        signalCount={project.signalCount}
      />

      {project.opportunities.length === 0 ? (
        <section className="empty-panel">
          <h2>No opportunities yet</h2>
          <p>Configure sources and triggers in Settings, then run the pipeline for your first morning review.</p>
        </section>
      ) : (
        <section aria-labelledby="opportunities-heading" className="review-section">
          <div className="section-head">
            <h2 id="opportunities-heading">Opportunities</h2>
            <p>{plural(project.opportunities.length, "idea", "ideas")} available for review</p>
          </div>
          <div className="card-grid">
            {project.opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} projectId={project.id} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
