import { redirect } from "next/navigation";
import { getRequestAuthContext } from "@/lib/auth/request-session";
import { isHostedAuthRequired } from "@/lib/auth/supabase-auth";
import { generatedRepoConnectionCanCreate } from "@/lib/build/github-target";
import {
  getProjectBundle,
  setProjectGeneratedRepoTargetConnection,
  upsertGitHubConnection,
  upsertGitHubUserToken
} from "@/lib/db/repository";
import {
  exchangeGitHubUserCode,
  fetchGitHubInstallationAccount,
  fetchGitHubUserProfile,
  githubPermissionScopes,
  parseGitHubCallbackState
} from "@/lib/github/github-app";
import { callbackSafeErrorMessage } from "@/lib/security/callback-errors";

export const dynamic = "force-dynamic";

type GitHubCallbackPageProps = {
  searchParams: Promise<{
    installation_id?: string;
    code?: string;
    setup_action?: string;
    state?: string;
  }>;
};

export default async function GitHubCallbackPage({ searchParams }: GitHubCallbackPageProps) {
  const params = await searchParams;
  const state = parseGitHubCallbackState(params.state);
  const projectId = state.projectId ?? undefined;
  const installationId = params.installation_id;
  const code = params.code;
  const destination = projectId ? `/projects/${projectId}/settings` : "/";
  const redirectUrl = new URL(destination, "http://forge.local");

  if (state.invalid) {
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("github_message", "GitHub callback state could not be verified.");
    redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  }

  const requestAuth = await getRequestAuthContext();
  if (!requestAuth && isHostedAuthRequired() && (projectId || installationId || code)) {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("github_message", "Sign in before connecting GitHub.");
    redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  }

  if (projectId) {
    const bundle = await getProjectBundle(projectId);
    if (!bundle.project) {
      redirectUrl.searchParams.set("github", "error");
      redirectUrl.searchParams.set("github_message", "Project not found for this GitHub callback.");
      redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
    }
  }

  if (installationId) {
    try {
      const account = await fetchGitHubInstallationAccount(installationId);
      const scopes = githubPermissionScopes(account.permissions);
      const connection = await upsertGitHubConnection({
        accountLogin: account.login,
        accountType: account.type,
        installationId,
        provider: "github_app",
        scopes: scopes.length > 0 ? scopes : ["metadata", "contents:read", "issues:read"]
      });
      if (code) {
        const access = await exchangeGitHubUserCode(code);
        await upsertGitHubUserToken({
          connectionId: connection.id,
          accessToken: access.token,
          tokenType: access.tokenType,
          expiresAt: access.expiresAt,
          refreshToken: access.refreshToken,
          refreshTokenExpiresAt: access.refreshTokenExpiresAt,
          scopes: access.scopes
        });
      }
      if (projectId) {
        const bundle = await getProjectBundle(projectId);
        if (!bundle.project?.repo_url) {
          await setProjectGeneratedRepoTargetConnection({
            projectId,
            connectionId: connection.id,
            accountLogin: account.login,
            repoCreation: generatedRepoConnectionCanCreate(connection) ? "github_app_org_create" : "precreated_only"
          });
        }
      }
      redirectUrl.searchParams.set("github", "connected");
      redirectUrl.searchParams.set("github_account", account.login);
      redirectUrl.searchParams.set("github_provider", "app");
    } catch (error) {
      redirectUrl.searchParams.set("github", "error");
      redirectUrl.searchParams.set(
        "github_message",
        callbackSafeErrorMessage(error, "GitHub App installation could not be saved.")
      );
    }
  } else if (code) {
    try {
      const access = await exchangeGitHubUserCode(code);
      const profile = await fetchGitHubUserProfile(access.token);
      const connection = await upsertGitHubConnection({
        accountLogin: profile.login,
        accountType: profile.type,
        provider: "github_oauth",
        scopes: access.scopes
      });
      await upsertGitHubUserToken({
        connectionId: connection.id,
        accessToken: access.token,
        tokenType: access.tokenType,
        expiresAt: access.expiresAt,
        refreshToken: access.refreshToken,
        refreshTokenExpiresAt: access.refreshTokenExpiresAt,
        scopes: access.scopes
      });
      if (projectId) {
        const bundle = await getProjectBundle(projectId);
        if (!bundle.project?.repo_url) {
          await setProjectGeneratedRepoTargetConnection({
            projectId,
            connectionId: connection.id,
            accountLogin: profile.login,
            repoCreation: "github_oauth_user_create"
          });
        }
      }
      redirectUrl.searchParams.set("github", "connected");
      redirectUrl.searchParams.set("github_account", profile.login);
      redirectUrl.searchParams.set("github_provider", "oauth");
    } catch (error) {
      redirectUrl.searchParams.set("github", "error");
      redirectUrl.searchParams.set(
        "github_message",
        callbackSafeErrorMessage(error, "GitHub user authorization could not be saved.")
      );
    }
  }

  redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
}
