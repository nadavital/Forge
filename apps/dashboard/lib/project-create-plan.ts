import { normalizeGithubRepository } from "./project-onboarding.ts";
import type { ProjectMode } from "../types/forge.ts";

export type ProjectCreationPlan =
  | {
      ok: true;
      mode: ProjectMode;
      repoUrl: string | null;
      shouldRunInitialPipeline: boolean;
      shouldStartIdeaConversation: boolean;
      shouldConnectGitHubFirst: boolean;
    }
  | {
      ok: false;
      message: string;
    };

type Env = Partial<Record<string, string | undefined>>;

export function planProjectCreation(input: { repoUrl?: string | null; env?: Env }): ProjectCreationPlan {
  const rawRepoUrl = input.repoUrl?.trim();
  if (!rawRepoUrl) {
    return {
      ok: true,
      mode: "new_product",
      repoUrl: null,
      shouldRunInitialPipeline: false,
      shouldStartIdeaConversation: true,
      shouldConnectGitHubFirst: false
    };
  }

  const repo = normalizeGithubRepository(rawRepoUrl);
  if (!repo) {
    return {
      ok: false,
      message: "Use a GitHub repository URL like https://github.com/org/repo."
    };
  }

  const hostedRequiresConnection = truthy((input.env ?? process.env).FORGE_REQUIRE_AUTH);
  return {
    ok: true,
    mode: "connected_product",
    repoUrl: repo.repoUrl,
    shouldRunInitialPipeline: !hostedRequiresConnection,
    shouldStartIdeaConversation: false,
    shouldConnectGitHubFirst: hostedRequiresConnection
  };
}

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value || "").toLowerCase());
}
