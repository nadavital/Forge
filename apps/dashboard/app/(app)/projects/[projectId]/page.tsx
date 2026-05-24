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
          <p>
            Add context, then click Dream now. A GitHub repo is optional for new products; Forge can create one after
            you approve a build.
          </p>
        </section>
      ) : (
        <>
          {project.digest ? (
            <section className="dream-digest" aria-label="Latest dream summary">
              <span className="digest-kicker">Latest dream</span>
              <h2>What Forge improved</h2>
              <p className="digest-summary">{project.digest.summary}</p>
              {project.digest.changes.length > 0 ? (
                <ul>
                  {project.digest.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              ) : null}
              {project.digest.topRecommendation ? (
                <p className="dream-recommendation">Top recommendation: {project.digest.topRecommendation}</p>
              ) : null}
              {project.digest.reflectionProposalCount !== undefined ? (
                <p className="dream-recommendation">
                  Self-improvement: {project.digest.reflectionProposalCount} proposal
                  {project.digest.reflectionProposalCount === 1 ? "" : "s"} created before this review.
                </p>
              ) : null}
            </section>
          ) : null}

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
        </>
      )}
    </main>
  );
}
