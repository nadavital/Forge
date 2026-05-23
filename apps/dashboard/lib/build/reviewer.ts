import type { DbBuildArtifact } from "@/lib/db/types";

export type BuildReviewResult = {
  passed: boolean;
  missing: string[];
  summary: string;
};

const REQUIRED_ARTIFACT_TYPES = ["readme", "test_result", "run_instruction", "service_manifest"];

export function reviewBuildArtifacts(
  artifacts: Array<Omit<DbBuildArtifact, "id" | "mvp_build_id">>
): BuildReviewResult {
  const available = new Set(artifacts.map((artifact) => artifact.artifact_type));
  const missing = REQUIRED_ARTIFACT_TYPES.filter((type) => !available.has(type));

  return {
    passed: missing.length === 0,
    missing,
    summary:
      missing.length === 0
        ? "BuildReviewer passed README, run instructions, smoke checks, and free-service manifest."
        : `BuildReviewer blocked completion. Missing: ${missing.map((type) => type.replace(/_/g, " ")).join(", ")}.`
  };
}
