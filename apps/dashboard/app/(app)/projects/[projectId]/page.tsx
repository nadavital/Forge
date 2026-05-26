import { notFound } from "next/navigation";
import { IdeaIntakePanel } from "@/components/ideas/IdeaIntakePanel";
import { OpportunityCard } from "@/components/opportunities/OpportunityCard";
import { ProjectHeader } from "@/components/projects/ProjectHeader";
import { StatusAutoRefresh } from "@/components/projects/StatusAutoRefresh";
import { loadDashboardProject, loadIdeaConversation } from "@/lib/dashboard-data";
import { getRequestRealtimeAccessToken } from "@/lib/auth/request-session";
import { plural } from "@/lib/decision";
import { projectPrimaryAction } from "@/lib/project-primary-action";
import { shouldAutoRefreshProject } from "@/lib/realtime/refresh-policy";
import { statusRealtimeConfigFromEnv } from "@/lib/realtime/supabase-realtime";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const [project, conversation] = await Promise.all([
    loadDashboardProject(projectId),
    loadIdeaConversation(projectId)
  ]);

  if (!project) {
    notFound();
  }

  const realtimeBase = statusRealtimeConfigFromEnv();
  const realtimeAccessToken = realtimeBase ? await getRequestRealtimeAccessToken() : null;
  const realtime = realtimeBase && realtimeAccessToken
    ? { ...realtimeBase, accessToken: realtimeAccessToken }
    : null;

  return (
    <main className="page">
      <StatusAutoRefresh
        enabled={shouldAutoRefreshProject({ project, conversation })}
        projectId={project.id}
        realtime={realtime}
      />

      <ProjectHeader
        mode={project.mode}
        opportunityCount={project.opportunities.length}
        primaryAction={projectPrimaryAction(project, conversation)}
        projectId={project.id}
        projectName={project.name}
        runStatus={project.runStatus}
        signalCount={project.signalCount}
      />

      <IdeaIntakePanel conversation={conversation} projectId={project.id} />

      {project.opportunities.length === 0 ? (
        <section className="empty-panel empty-panel-primary">
          <span className="empty-kicker">Latest Dream</span>
          <h2>No recommendations ready</h2>
          <p>{project.digest?.summary ?? "Forge has not completed a review for this project yet."}</p>
          {project.digest?.stages && project.digest.stages.length > 0 ? (
            <div className="run-state-strip compact" aria-label="Pipeline stage state">
              {project.digest.stages.map((stage) => (
                <article className={`run-state-pill ${stage.status}`} key={stage.label}>
                  <span>{stage.label}</span>
                  <strong>{stageStatusLabel(stage.status)}</strong>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="opportunities-heading" className="review-section">
          <div className="section-head">
            <h2 id="opportunities-heading">Recommendations</h2>
            <p>{plural(project.opportunities.length, "recommendation")} ready</p>
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
