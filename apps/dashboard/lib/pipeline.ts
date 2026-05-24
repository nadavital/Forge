import {
  completePipelineRun,
  createPipelineRun,
  getProjectBundle,
  replaceProjectDiscoveryRecords,
  updateProjectRepository
} from "@/lib/db/repository";
import { discoverGitHubRepo } from "@/lib/github/repo-discovery";
import { discoverNewProductIdeas } from "@/lib/ideas/new-product-discovery";
import { runReflection } from "@/lib/reflection/reflection-engine";
import { rankOpportunitiesWithPreferences } from "@/lib/scoring/preference-ranking";

export async function triggerProjectPipeline(projectId: string): Promise<{ runId: string; message: string }> {
  const reflection = await runReflection({ projectId });
  const run = await createPipelineRun(projectId);
  const bundle = await getProjectBundle(projectId);
  const repoUrl = bundle.project?.repo_url || githubSourceRepoUrl(bundle.sources);
  const reflectionLine = `Reflected on prior decisions and generated ${reflection.proposalCount} self-improvement proposal${reflection.proposalCount === 1 ? "" : "s"}`;

  if (repoUrl) {
    const discovery = await discoverGitHubRepo(repoUrl);
    await updateProjectRepository({
      projectId,
      repoUrl: discovery.repoUrl,
      productContext: discovery.productContext
    });
    await replaceProjectDiscoveryRecords({
      projectId,
      runId: run.id,
      signals: discovery.signals,
      opportunities: rankOpportunitiesWithPreferences({
        opportunities: discovery.opportunities,
        existingOpportunities: bundle.opportunities,
        preferenceEvents: bundle.preferenceEvents,
        preferences: bundle.preferences
      })
    });

    await completePipelineRun(run.id, {
      source: "github",
      repo_url: discovery.repoUrl,
      digest_summary:
        discovery.opportunities.length > 0
          ? `Analyzed ${discovery.projectName} and generated ${discovery.opportunities.length} repo-specific opportunities.`
          : `Analyzed ${discovery.projectName}. Forge collected repo context but did not find enough evidence for a recommendation yet.`,
      changes: [
        reflectionLine,
        `Collected ${discovery.signals.length} GitHub repo signals`,
        discovery.opportunities.length > 0
          ? `Ranked ${discovery.opportunities.length} opportunities from README and issue context`
          : "No recommendation cards were created because the repo evidence was too thin",
        discovery.opportunities.length > 0
          ? "Build briefs will target the connected repository"
          : "Add issues, notes, or run managed research to generate stronger opportunities"
      ],
      reflection_proposal_count: reflection.proposalCount,
      reflection_run_ids: reflection.runIds,
      project_knowledge: discovery.knowledge
    });

    return {
      runId: run.id,
      message:
        discovery.opportunities.length > 0
          ? `Pipeline run completed for ${discovery.projectName}. Refresh to review repo-specific ideas.`
          : `Pipeline run completed for ${discovery.projectName}. Forge needs more evidence before recommending ideas.`
    };
  }

  const discovery = discoverNewProductIdeas({
    projectName: bundle.project?.name ?? "New product",
    preferences: bundle.preferences
  });
  await replaceProjectDiscoveryRecords({
    projectId,
    runId: run.id,
    signals: discovery.signals,
    opportunities: rankOpportunitiesWithPreferences({
      opportunities: discovery.opportunities,
      existingOpportunities: bundle.opportunities,
      preferenceEvents: bundle.preferenceEvents,
      preferences: bundle.preferences
    })
  });

  await completePipelineRun(run.id, {
    source: "new_product_generated",
    digest_summary:
      discovery.opportunities.length > 0
        ? `Generated ${discovery.opportunities.length} new-product direction${discovery.opportunities.length === 1 ? "" : "s"} from explicit project context.`
        : "Collected project context. Forge needs concrete notes, feedback, or research evidence before recommending ideas.",
    changes: [
      reflectionLine,
      `Collected ${discovery.signals.length} project context signals`,
      discovery.opportunities.length > 0
        ? `Ranked ${discovery.opportunities.length} manually grounded idea${discovery.opportunities.length === 1 ? "" : "s"} for review`
        : "No recommendation cards were created because no concrete product evidence was supplied",
      "Forge will not show seeded placeholder opportunities as recommendations"
    ],
    reflection_proposal_count: reflection.proposalCount,
    reflection_run_ids: reflection.runIds
  });

  return {
    runId: run.id,
    message: "Pipeline run completed. Refresh to review generated product ideas."
  };
}

function githubSourceRepoUrl(sources: Array<{ source_type: string; config?: Record<string, unknown> }>): string {
  const source = sources.find((entry) => entry.source_type === "github" && entry.config?.repo_url);
  return typeof source?.config?.repo_url === "string" ? source.config.repo_url : "";
}
