import { triggerProjectPipeline } from "@/lib/pipeline";
import { getActiveIdentity, loadStore, markTriggerRan } from "@/lib/db/repository";
import { projectVisibleToIdentity } from "@/lib/db/identity-scope";
import { shouldRunScheduledProjectTrigger } from "./policy.ts";
import type { DbTrigger } from "@/lib/db/types";

export async function runDueProjectTriggers(input: { projectId?: string; now?: Date } = {}): Promise<Array<{ projectId: string; runId: string }>> {
  const store = await loadStore();
  const identity = await getActiveIdentity();
  const visibleProjectIds = new Set(
    store.projects.filter((project) => projectVisibleToIdentity(project, identity)).map((project) => project.id)
  );
  const now = input.now ?? new Date();
  const due = store.triggers.filter(
    (trigger) =>
      visibleProjectIds.has(trigger.project_id) &&
      (!input.projectId || trigger.project_id === input.projectId) &&
      isDueProjectTrigger(trigger, now)
  );

  const results: Array<{ projectId: string; runId: string }> = [];
  for (const trigger of due) {
    const project = store.projects.find((row) => row.id === trigger.project_id);
    if (!shouldRunScheduledProjectTrigger(project, store.research_briefs)) {
      await markTriggerRan({ projectId: trigger.project_id, triggerId: trigger.id });
      continue;
    }
    const result = await triggerProjectPipeline(trigger.project_id);
    await markTriggerRan({ projectId: trigger.project_id, triggerId: trigger.id });
    results.push({ projectId: trigger.project_id, runId: result.runId });
  }
  return results;
}

export function isDueProjectTrigger(trigger: Pick<DbTrigger, "status" | "trigger_type" | "last_run_at" | "config">, now = new Date()): boolean {
  if (trigger.status !== "active") return false;
  if (trigger.trigger_type === "manual") return false;
  const lastRun = trigger.last_run_at ? new Date(trigger.last_run_at) : null;
  if (!lastRun || Number.isNaN(lastRun.getTime())) return true;
  return now.getTime() - lastRun.getTime() >= scheduleIntervalMs(trigger.config);
}

function scheduleIntervalMs(config: unknown): number {
  if (!config || typeof config !== "object") return 24 * 60 * 60 * 1000;
  const hours = (config as { interval_hours?: unknown }).interval_hours;
  return typeof hours === "number" && hours > 0 ? hours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}
