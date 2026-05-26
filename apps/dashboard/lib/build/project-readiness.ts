import type { DbGitHubConnection, DbProject, DbSourceConfig } from "../db/types.ts";
import { canUseManagedBuilderEnv, selectBuilderAdapter, type BuilderAdapter } from "./adapter.ts";
import {
  managedBuildGitHubTargetReadiness,
  selectBuildGitHubTarget,
  type BuildGitHubTarget
} from "./github-target.ts";
import type { BuildReadiness } from "./readiness.ts";

type Env = Partial<Record<string, string | undefined>>;

export type ProjectBuildReadiness = BuildReadiness & {
  adapter: BuilderAdapter;
  githubTarget: BuildGitHubTarget;
};

export function projectBuildReadiness(input: {
  project: Pick<DbProject, "repo_url">;
  sources: Pick<DbSourceConfig, "source_type" | "connection_id">[];
  githubConnections: DbGitHubConnection[];
  requestedAdapter?: BuilderAdapter;
  env?: Env;
}): ProjectBuildReadiness {
  const env = input.env ?? process.env;
  const githubTarget = selectBuildGitHubTarget({
    project: input.project,
    sources: input.sources,
    githubConnections: input.githubConnections
  });
  const adapter = selectBuilderAdapter({
    requested: input.requestedAdapter,
    hasBuildTarget: true,
    env
  });

  if (adapter === "simulated") {
    return {
      adapter,
      githubTarget,
      canBuild: true,
      reason: "Simulated builder can run without a GitHub PR target."
    };
  }

  if (!canUseManagedBuilderEnv(env)) {
    return {
      adapter,
      githubTarget,
      canBuild: false,
      reason: "GEMINI_API_KEY is required before the managed builder can start."
    };
  }

  const targetReadiness = managedBuildGitHubTargetReadiness({
    project: input.project,
    target: githubTarget,
    env
  });
  return {
    adapter,
    githubTarget,
    canBuild: targetReadiness.canCreatePr,
    reason: targetReadiness.reason
  };
}
