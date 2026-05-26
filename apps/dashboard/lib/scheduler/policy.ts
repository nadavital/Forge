import type { DbProject, DbResearchBrief } from "../db/types.ts";

export function shouldRunScheduledProjectTrigger(
  project: Pick<DbProject, "id" | "mode"> | undefined,
  researchBriefs: Array<Pick<DbResearchBrief, "project_id" | "status">>
): boolean {
  if (!project) return false;
  if (project.mode !== "new_product") return true;
  return researchBriefs.some((brief) => brief.project_id === project.id && brief.status === "approved");
}
