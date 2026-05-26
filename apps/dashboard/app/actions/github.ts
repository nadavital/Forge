"use server";

import { revalidatePath } from "next/cache";
import { generatedRepoConnectionCanCreate } from "@/lib/build/github-target";
import type { DbGitHubConnection } from "@/lib/db/types";
import {
  getProjectBundle,
  setProjectGeneratedRepoTargetConnection,
  updateGitHubConnectionStatus,
  updateProjectRepository,
  upsertGitHubConnection
} from "@/lib/db/repository";
import {
  checkGitHubConnectionHealth,
  fetchGitHubInstallationAccount,
  githubPermissionScopes,
  isGitHubDevelopmentFallbackEnabled,
  isGitHubInstallationGoneError,
  listInstallationRepositories
} from "@/lib/github/github-app";
import { githubConnectionCanLinkRepository } from "@/lib/github/repo-connection-policy";
import { normalizeGithubRepository } from "@/lib/project-onboarding";

export async function connectGitHubInstallation(input: {
  projectId: string;
  accountLogin: string;
  installationId: string;
  repoUrl: string;
}) {
  if (!isGitHubDevelopmentFallbackEnabled()) {
    return {
      ok: false as const,
      message: "Manual GitHub installation-id entry is disabled. Use the GitHub App install or GitHub user OAuth flow."
    };
  }

  const accountLogin = input.accountLogin.trim();
  const installationId = input.installationId.trim();
  const repoInput = input.repoUrl.trim();
  const repo = repoInput ? normalizeGithubRepository(repoInput) : null;

  if (!accountLogin || !installationId) {
    return { ok: false as const, message: "Add a GitHub account and installation id." };
  }
  if (repoInput && !repo) {
    return { ok: false as const, message: "Choose a valid GitHub repository or leave it blank." };
  }

  const bundle = await getProjectBundle(input.projectId);
  if (!bundle.project) {
    return { ok: false as const, message: "Project not found." };
  }
  let account: Awaited<ReturnType<typeof fetchGitHubInstallationAccount>>;
  try {
    account = await fetchGitHubInstallationAccount(installationId);
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "GitHub installation metadata could not be verified."
    };
  }
  if (account.login.toLowerCase() !== accountLogin.toLowerCase()) {
    return {
      ok: false as const,
      message: `Installation ${installationId} belongs to ${account.login}, not ${accountLogin}.`
    };
  }
  const scopes = githubPermissionScopes(account.permissions);

  const connection = await upsertGitHubConnection({
    accountLogin: account.login,
    accountType: account.type,
    installationId,
    provider: "github_app",
    scopes: scopes.length > 0 ? scopes : ["metadata", "contents:read", "issues:read"]
  });

  if (repo) {
    await updateProjectRepository({
      projectId: input.projectId,
      repoUrl: repo.repoUrl,
      connectionId: connection.id
    });
  } else {
    await setProjectGeneratedRepoTargetConnection({
      projectId: input.projectId,
      connectionId: connection.id,
      accountLogin: account.login,
      repoCreation: repoCreationMode(connection)
    });
  }

  revalidatePath(`/projects/${input.projectId}/settings`);
  revalidatePath(`/projects/${input.projectId}`);
  return {
    ok: true as const,
    message: repo
      ? `Connected ${account.login} through GitHub App installation metadata.`
      : `Saved ${account.login} as the GitHub App target for generated repos.`
  };
}

export async function listGitHubConnectionRepositories(input: {
  projectId: string;
  connectionId: string;
}) {
  const bundle = await getProjectBundle(input.projectId);
  const connection = bundle.githubConnections.find((row) => row.id === input.connectionId);
  if (!connection) {
    return { ok: false as const, message: "GitHub connection not found.", repositories: [] };
  }

  try {
    const repositories = await listInstallationRepositories(connection);
    return { ok: true as const, message: `Loaded ${repositories.length} repositories.`, repositories };
  } catch (error) {
    const message = await handleGitHubConnectionError({
      projectId: input.projectId,
      connectionId: connection.id,
      error
    });
    return {
      ok: false as const,
      message,
      repositories: []
    };
  }
}

export async function checkGitHubConnection(input: {
  projectId: string;
  connectionId: string;
}) {
  const bundle = await getProjectBundle(input.projectId);
  const connection = bundle.githubConnections.find((row) => row.id === input.connectionId);
  if (!connection) {
    return { ok: false as const, message: "GitHub connection not found.", health: null };
  }

  try {
    const health = await checkGitHubConnectionHealth(connection);
    const authLabel = health.authSource === "github_oauth" ? "GitHub user OAuth" : "GitHub App";
    return {
      ok: true as const,
      message: `${authLabel} access verified for ${health.accountLogin}; ${health.repositoryCount} repositories visible.`,
      health
    };
  } catch (error) {
    const message = await handleGitHubConnectionError({
      projectId: input.projectId,
      connectionId: connection.id,
      error
    });
    return {
      ok: false as const,
      message,
      health: null
    };
  }
}

export async function linkGitHubRepository(input: {
  projectId: string;
  connectionId: string;
  repoUrl: string;
}) {
  const bundle = await getProjectBundle(input.projectId);
  const connection = bundle.githubConnections.find((row) => row.id === input.connectionId);
  const repo = normalizeGithubRepository(input.repoUrl.trim());
  if (!connection || !repo) {
    return { ok: false as const, message: "Choose a valid GitHub connection and repository." };
  }
  const linkPolicy = githubConnectionCanLinkRepository(connection);
  if (!linkPolicy.ok) {
    return { ok: false as const, message: linkPolicy.reason };
  }

  await updateProjectRepository({
    projectId: input.projectId,
    repoUrl: repo.repoUrl,
    connectionId: connection.id
  });

  revalidatePath(`/projects/${input.projectId}/settings`);
  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true as const, message: `Linked ${repo.owner}/${repo.repo} to this project.` };
}

export async function useGitHubConnectionForGeneratedRepos(input: {
  projectId: string;
  connectionId: string;
}) {
  const bundle = await getProjectBundle(input.projectId);
  const connection = bundle.githubConnections.find((row) => row.id === input.connectionId);
  if (!bundle.project || !connection) {
    return { ok: false as const, message: "Choose a valid GitHub connection." };
  }
  if (bundle.project.repo_url) {
    return {
      ok: false as const,
      message: "Generated repo targets are only used for new-product projects without a connected repo."
    };
  }
  if (connection.status !== "active") {
    return { ok: false as const, message: "Reconnect this GitHub connection before using it for generated repos." };
  }
  if (connection.provider === "github_app" && !connection.installation_id) {
    return { ok: false as const, message: "Reconnect this GitHub App installation before using it for generated repos." };
  }

  await setProjectGeneratedRepoTargetConnection({
    projectId: input.projectId,
    connectionId: connection.id,
    accountLogin: connection.account_login,
    repoCreation: repoCreationMode(connection)
  });

  revalidatePath(`/projects/${input.projectId}/settings`);
  revalidatePath(`/projects/${input.projectId}`);
  return {
    ok: true as const,
    message: generatedRepoConnectionCanCreate(connection)
      ? `Generated MVP repos can be created under ${connection.account_login}.`
      : `Generated MVP repos will target pre-created repositories visible to ${connection.account_login}.`
  };
}

function repoCreationMode(connection: DbGitHubConnection): string {
  if (generatedRepoConnectionCanCreate(connection)) {
    return connection.provider === "github_oauth" ? "github_oauth_user_create" : "github_app_org_create";
  }
  return "precreated_only";
}

async function handleGitHubConnectionError(input: {
  projectId: string;
  connectionId: string;
  error: unknown;
}): Promise<string> {
  if (isGitHubInstallationGoneError(input.error)) {
    await updateGitHubConnectionStatus({
      connectionId: input.connectionId,
      status: "needs_reauth"
    });
    revalidatePath(`/projects/${input.projectId}/settings`);
    revalidatePath(`/projects/${input.projectId}`);
    return "GitHub no longer recognizes this installation. Marked the connection as needing reauthorization.";
  }

  return input.error instanceof Error ? input.error.message : String(input.error);
}
