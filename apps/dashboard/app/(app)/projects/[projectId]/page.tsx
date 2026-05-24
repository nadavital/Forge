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

      {project.digest ? (
        <section className="dream-digest project-intelligence" aria-label="Latest dream summary">
          {project.digest.projectKnowledge ? (
            <section className="knowledge-panel primary" aria-label="Project knowledge memory">
              <div className="knowledge-copy">
                <span className="digest-kicker">Project memory</span>
                <h2>Forge learned {project.name}</h2>
                <p>{project.digest.projectKnowledge.summary}</p>
              </div>
              <div className="knowledge-meta-row">
                <div className="knowledge-stats">
                  {project.digest.projectKnowledge.evidenceCounts.filesSeen !== undefined ? (
                    <span>{project.digest.projectKnowledge.evidenceCounts.filesSeen} files</span>
                  ) : null}
                  {project.digest.projectKnowledge.evidenceCounts.surfacesDetected !== undefined ? (
                    <span>{project.digest.projectKnowledge.evidenceCounts.surfacesDetected} workflows</span>
                  ) : null}
                  {project.digest.projectKnowledge.evidenceCounts.issuesSeen !== undefined ? (
                    <span>{project.digest.projectKnowledge.evidenceCounts.issuesSeen} issues</span>
                  ) : null}
                </div>
                {project.digest.projectKnowledge.frameworks.length > 0 ? (
                  <div className="knowledge-tags">
                    {project.digest.projectKnowledge.frameworks.map((framework) => (
                      <span key={framework}>{framework}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              {project.digest.projectKnowledge.surfaces.length > 0 ? (
                <div className="knowledge-surfaces">
                  {project.digest.projectKnowledge.surfaces.map((surface) => (
                    <article key={surface.label}>
                      <strong>{surface.label}</strong>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : (
            <div className="knowledge-copy">
              <span className="digest-kicker">Latest dream</span>
              <h2>Forge reviewed {project.name}</h2>
              <p className="digest-summary">{project.digest.summary}</p>
            </div>
          )}
          {project.digest.stages && project.digest.stages.length > 0 ? (
            <div className="run-state-strip" aria-label="Pipeline stage state">
              {project.digest.stages.map((stage) => (
                <article className={`run-state-pill ${stage.status}`} key={stage.label}>
                  <span>{stage.label}</span>
                  <strong>{stageStatusLabel(stage.status)}</strong>
                </article>
              ))}
            </div>
          ) : null}
          {project.digest.reflectionProposalCount !== undefined ? (
            <p className="dream-footnote">
              Self-improvement pass created {project.digest.reflectionProposalCount} proposal
              {project.digest.reflectionProposalCount === 1 ? "" : "s"} before this review.
            </p>
          ) : null}
        </section>
      ) : null}

      {project.opportunities.length === 0 ? (
        <section className="empty-panel">
          <span className="empty-kicker">No placeholders shown</span>
          <h2>No evidence-backed opportunities yet</h2>
          <p>
            Forge collected the available context, but it will not fabricate generic cards. Add concrete issues, notes,
            feedback, or run managed research when you need deeper evidence.
          </p>
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

function stageStatusLabel(status: string): string {
  if (status === "not_run") return "Optional";
  return status;
}
