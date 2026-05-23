import { triggerProjectPipeline } from "@/lib/pipeline";
import { loadStore, markTriggerRan } from "@/lib/db/repository";

export async function runDueProjectTriggers(now = new Date()): Promise<Array<{ projectId: string; runId: string }>> {
  const store = await loadStore();
  const due = store.triggers.filter((trigger) => {
    if (trigger.status !== "active") return false;
    if (trigger.trigger_type === "manual") return false;
    const lastRun = trigger.last_run_at ? new Date(trigger.last_run_at) : null;
    if (!lastRun || Number.isNaN(lastRun.getTime())) return true;
    return now.getTime() - lastRun.getTime() >= scheduleIntervalMs(trigger.config);
  });

  const results: Array<{ projectId: string; runId: string }> = [];
  for (const trigger of due) {
    const result = await triggerProjectPipeline(trigger.project_id);
    await markTriggerRan(trigger.id);
    results.push({ projectId: trigger.project_id, runId: result.runId });
  }
  return results;
}

function scheduleIntervalMs(config: unknown): number {
  if (!config || typeof config !== "object") return 24 * 60 * 60 * 1000;
  const hours = (config as { interval_hours?: unknown }).interval_hours;
  return typeof hours === "number" && hours > 0 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}
