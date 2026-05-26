import type { DbGitHubConnection, DbProject, DbSourceConfig } from "../db/types.ts";
import { githubTokenFallbackEnabled } from "../github/token-fallback.ts";

export const GENERATED_REPO_TARGET_SOURCE_TYPE = "github_generated_repo_target";

export type BuildGitHubTarget = {
  githubConnectionId: string | null;
  githubConnection?: DbGitHubConnection;
  githubConnectionCanWrite?: boolean;
  generatedRepoAccountLogin?: string | null;
  generatedRepoCanCreate?: boolean;
};

type Env = Partial<Record<string, string | undefined>>;

export type BuildGitHubTargetReadiness = {
  canCreatePr: boolean;
  reason: string;
};

export function selectBuildGitHubTarget(input: {
  project: Pick<DbProject, "repo_url">;
  sources: Pick<DbSourceConfig, "source_type" | "connection_id">[];
  githubConnections: DbGitHubConnection[];
}): BuildGitHubTarget {
  const sourceType = input.project.repo_url ? "github" : GENERATED_REPO_TARGET_SOURCE_TYPE;
  const connectionId = input.sources.find((source) => source.source_type === sourceType)?.connection_id ?? null;
  const connection = connectionId
    ? input.githubConnections.find((row) => row.id === connectionId && row.status === "active")
    : undefined;
  const usableConnection = input.project.repo_url && connection?.provider === "github_oauth" ? undefined : connection;

  return {
    githubConnectionId: usableConnection?.id ?? null,
    githubConnection: usableConnection,
    githubConnectionCanWrite: githubConnectionCanWriteContents(usableConnection),
    generatedRepoAccountLogin: input.project.repo_url ? null : usableConnection?.account_login ?? null,
    generatedRepoCanCreate: !input.project.repo_url && generatedRepoConnectionCanCreate(usableConnection)
  };
}

export function managedBuildGitHubTargetReadiness(input: {
  project: Pick<DbProject, "repo_url">;
  target: BuildGitHubTarget;
  env?: Env;
}): BuildGitHubTargetReadiness {
  if (input.target.githubConnectionId) {
    if (input.project.repo_url && input.target.githubConnection?.provider === "github_oauth") {
      return {
        canCreatePr: false,
        reason:
          "Existing-repo managed builds require a GitHub App installation. GitHub user OAuth is only for generated repo targets."
      };
    }
    if (!input.target.githubConnectionCanWrite) {
      return {
        canCreatePr: false,
        reason: input.project.repo_url
          ? "The linked GitHub connection needs Contents write permission before Forge can create a managed PR."
          : "The generated-repo GitHub target needs Contents write permission before Forge can commit MVP files."
      };
    }
    return {
      canCreatePr: true,
      reason: "Managed PR creation can use the project-linked GitHub connection."
    };
  }
  if (localDevTokenFallbackEnabled(input.env ?? process.env)) {
    return {
      canCreatePr: true,
      reason: "Managed PR creation can use the explicit local development GitHub token fallback."
    };
  }
  if (input.project.repo_url) {
    return {
      canCreatePr: false,
      reason:
        "Connect this repository with a GitHub App installation before starting a managed build. GitHub user OAuth is only for generated repo targets, and broad server GitHub tokens are ignored unless FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 is set for local development."
    };
  }
  return {
    canCreatePr: false,
    reason:
      "Choose a generated-repo GitHub target with the GitHub App or GitHub user OAuth before starting a managed build. Broad server GitHub tokens are ignored unless FORGE_ALLOW_GITHUB_TOKEN_FALLBACK=1 is set for local development."
  };
}

export function githubConnectionCanWriteContents(connection?: DbGitHubConnection): boolean {
  if (!connection || connection.status !== "active") {
    return false;
  }
  if (connection.provider === "github_oauth") {
    return true;
  }
  return githubConnectionHasScope(connection, "contents", "write");
}

export function generatedRepoConnectionCanCreate(connection?: DbGitHubConnection): boolean {
  if (!connection || connection.status !== "active") {
    return false;
  }
  if (connection.provider === "github_oauth") {
    return true;
  }
  return (
    connection.account_type === "Organization" &&
    Boolean(connection.installation_id) &&
    githubConnectionCanWriteContents(connection) &&
    githubConnectionHasScope(connection, "administration", "write")
  );
}

export function generatedRepoTargetSource(input: {
  id: string;
  projectId: string;
  connectionId: string;
  accountLogin: string;
  repoCreation?: string;
  now?: string;
}): DbSourceConfig {
  return {
    id: input.id,
    project_id: input.projectId,
    connection_id: input.connectionId,
    source_type: GENERATED_REPO_TARGET_SOURCE_TYPE,
    name: `${input.accountLogin} generated repos`,
    status: "active",
    config: {
      account_login: input.accountLogin,
      repo_creation: input.repoCreation ?? "github_app_org_or_precreated",
      updated_at: input.now ?? new Date().toISOString()
    }
  };
}

function localDevTokenFallbackEnabled(env: Env): boolean {
  return githubTokenFallbackEnabled(env);
}

function githubConnectionHasScope(
  connection: Pick<DbGitHubConnection, "scopes">,
  permission: string,
  level: "read" | "write"
): boolean {
  const scopes = connection.scopes ?? [];
  const expected = `${permission}:${level}`;
  if (scopes.includes(expected)) return true;
  if (level === "read" && scopes.includes(`${permission}:write`)) return true;
  return false;
}
