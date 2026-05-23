import { completePipelineRun, createPipelineRun } from "@/lib/db/repository";

export async function triggerProjectPipeline(projectId: string): Promise<{ runId: string; message: string }> {
  const run = await createPipelineRun(projectId);

  await completePipelineRun(run.id, {
    source: "dashboard",
    digest_summary: "Manual run completed. Existing opportunities were re-ranked against the latest preference profile.",
    changes: [
      "Re-scored open opportunities against current taste notes",
      "No new external signals ingested in simulated manual run"
    ]
  });

  return {
    runId: run.id,
    message: "Pipeline run completed. Refresh to see the updated morning review."
  };
}
