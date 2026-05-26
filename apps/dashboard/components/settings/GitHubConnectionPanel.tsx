"use client";

import { useState, useTransition } from "react";
import { GitBranch, PackagePlus, PlugZap, RefreshCw, ShieldCheck, UserRoundPlus } from "lucide-react";
import {
  checkGitHubConnection,
  connectGitHubInstallation,
  linkGitHubRepository,
  listGitHubConnectionRepositories,
  useGitHubConnectionForGeneratedRepos
} from "@/app/actions/github";
import type { ProjectSettingsView } from "@/types/forge";

type GitHubConnectionPanelProps = {
  projectId: string;
  settings: ProjectSettingsView;
};

type GitHubRepoOption = {
  id: number;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  defaultBranch?: string | null;
};

type GitHubConnectionHealth = {
  accountLogin: string;
  authSource?: "github_app" | "github_oauth";
  expiresAt?: string | null;
  permissions: Record<string, string>;
  repositorySelection?: string | null;
  repositoryCount: number;
};

export function GitHubConnectionPanel({ projectId, settings }: GitHubConnectionPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [repos, setRepos] = useState<Record<string, GitHubRepoOption[]>>({});
  const [health, setHealth] = useState<Record<string, GitHubConnectionHealth>>({});

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await connectGitHubInstallation({
        projectId,
        accountLogin: String(formData.get("accountLogin") ?? ""),
        installationId: String(formData.get("installationId") ?? ""),
        repoUrl: String(formData.get("repoUrl") ?? "")
      });
      setStatus(result.message);
    });
  }

  function loadRepos(connectionId: string) {
    startTransition(async () => {
      const result = await listGitHubConnectionRepositories({ projectId, connectionId });
      if (result.ok) {
        setRepos((current) => ({ ...current, [connectionId]: result.repositories }));
      }
      setStatus(result.message);
    });
  }

  function checkConnection(connectionId: string) {
    startTransition(async () => {
      const result = await checkGitHubConnection({ projectId, connectionId });
      if (result.ok && result.health) {
        setHealth((current) => ({ ...current, [connectionId]: result.health }));
      }
      setStatus(result.message);
    });
  }

  function linkRepo(connectionId: string, formData: FormData) {
    startTransition(async () => {
      const result = await linkGitHubRepository({
        projectId,
        connectionId,
        repoUrl: String(formData.get(`repo-${connectionId}`) ?? "")
      });
      setStatus(result.message);
    });
  }

  function useForGeneratedRepos(connectionId: string) {
    startTransition(async () => {
      const result = await useGitHubConnectionForGeneratedRepos({ projectId, connectionId });
      setStatus(result.message);
    });
  }

  function connectionCanUseRepos(connection: ProjectSettingsView["githubConnections"][number]): boolean {
    if (connection.status !== "active") return false;
    if (connection.provider === "github_oauth") return false;
    return Boolean(connection.installationId && settings.githubAppConfigured);
  }

  return (
    <section className="settings-section">
      <div className="settings-card-header">
        <div>
          <h2>GitHub connection</h2>
          <p className="settings-desc">
            Use a selected-repo GitHub App installation for project repositories. GitHub user OAuth is an optional
            generated-repo connector for user-owned MVP repos.
          </p>
        </div>
        <GitBranch aria-hidden="true" className="settings-header-icon" />
      </div>

      {!settings.githubAppConfigured ? (
        <p className="settings-desc">
          Configure `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to load App installation repositories.
        </p>
      ) : null}

      {!settings.githubOAuthConfigured ? (
        <p className="settings-desc">
          Configure `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` only if user-account generated repos should be
          creatable through OAuth.
        </p>
      ) : null}

      {settings.githubConnections.length ? (
        <ul className="settings-rows">
          {settings.githubConnections.map((connection) => (
            <li className="github-connection-row" key={connection.id}>
              <div>
                <strong>{connection.accountLogin}</strong>
                <span>
                  {connection.provider.replace("_", " ")} · {connection.status}
                </span>
              </div>
              <span>{connection.installationId ? `installation ${connection.installationId}` : "no installation"}</span>
              <button
                className="btn btn-secondary btn-compact"
                disabled={isPending || !connectionCanUseRepos(connection)}
                onClick={() => checkConnection(connection.id)}
                type="button"
              >
                <ShieldCheck aria-hidden="true" />
                Check
              </button>
              <button
                className="btn btn-secondary btn-compact"
                disabled={isPending || !connectionCanUseRepos(connection)}
                onClick={() => loadRepos(connection.id)}
                type="button"
              >
                <RefreshCw aria-hidden="true" />
                Repos
              </button>
              <button
                className="btn btn-secondary btn-compact"
                disabled={
                  isPending ||
                  connection.status !== "active" ||
                  (connection.provider === "github_app" && !connection.installationId)
                }
                onClick={() => useForGeneratedRepos(connection.id)}
                type="button"
              >
                <PackagePlus aria-hidden="true" />
                Generated repos
              </button>
              <GitHubConnectionPermissionNotes connection={connection} />
              {health[connection.id] ? <GitHubHealthSummary health={health[connection.id]} /> : null}
              {repos[connection.id]?.length ? (
                <form action={(formData) => linkRepo(connection.id, formData)} className="github-repo-picker">
                  <select defaultValue={settings.project.repoUrl} disabled={isPending} name={`repo-${connection.id}`}>
                    <option value="">Choose repository</option>
                    {repos[connection.id].map((repo) => (
                      <option key={repo.id} value={repo.htmlUrl}>
                        {repo.fullName}
                        {repo.private ? " (private)" : ""}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary btn-compact" disabled={isPending} type="submit">
                    Link
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {settings.githubInstallUrl ? (
        <a className="github-install-link" href={settings.githubInstallUrl}>
          Install GitHub App
        </a>
      ) : null}

      {settings.githubUserAuthUrl ? (
        <a className="github-install-link" href={settings.githubUserAuthUrl}>
          <UserRoundPlus aria-hidden="true" />
          Connect generated-repo account
        </a>
      ) : null}

      {settings.githubDevFallbackEnabled ? (
        <details className="github-dev-fallback">
          <summary>Development fallback</summary>
          <form action={onSubmit} className="github-connect-form">
            <input
              defaultValue={settings.githubConnections[0]?.accountLogin ?? ""}
              disabled={isPending}
              name="accountLogin"
              placeholder="GitHub account or org"
            />
            <input
              defaultValue={settings.githubConnections[0]?.installationId ?? ""}
              disabled={isPending}
              name="installationId"
              placeholder="App installation id"
            />
            <input
              defaultValue={settings.project.repoUrl}
              disabled={isPending}
              name="repoUrl"
              placeholder="owner/repo (optional)"
            />
            <button className="btn btn-secondary" disabled={isPending} type="submit">
              <PlugZap aria-hidden="true" />
              {isPending ? "Connecting…" : "Save connection"}
            </button>
          </form>
        </details>
      ) : null}

      {status ? (
        <p className="review-status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function GitHubHealthSummary({ health }: { health: GitHubConnectionHealth }) {
  const permissionEntries = Object.entries(health.permissions).slice(0, 4);
  const authLabel = health.authSource === "github_oauth" ? "OAuth access" : "App token";
  return (
    <div className="github-health">
      <span>
        {authLabel}
        {health.expiresAt ? ` expires ${formatDateTime(health.expiresAt)}` : ""} · {health.repositoryCount} repos ·{" "}
        {health.repositorySelection ?? "repository access"}
      </span>
      {permissionEntries.length ? (
        <small>{permissionEntries.map(([name, level]) => `${name}: ${level}`).join(" · ")}</small>
      ) : null}
    </div>
  );
}

function GitHubConnectionPermissionNotes({
  connection
}: {
  connection: ProjectSettingsView["githubConnections"][number];
}) {
  const notes = connectionPermissionNotes(connection);
  if (!notes.length) return null;
  return (
    <div className="github-connection-notes">
      {notes.map((note) => (
        <span key={note}>{note}</span>
      ))}
    </div>
  );
}

function connectionPermissionNotes(connection: ProjectSettingsView["githubConnections"][number]): string[] {
  if (connection.status !== "active") {
    return ["Reconnect before repo discovery or managed builds can use this connection."];
  }
  if (connection.provider === "github_oauth") {
    return ["OAuth is only used for generated repos owned by this GitHub user; use the GitHub App to connect project repos."];
  }

  const notes: string[] = [];
  if (!hasScope(connection.scopes, "contents", "write")) {
    notes.push("Managed PR builds need Contents write.");
  }
  if (connection.accountType === "Organization" && !hasScope(connection.scopes, "administration", "write")) {
    notes.push("Org generated-repo creation needs Administration write.");
  }
  if (connection.accountType === "User") {
    notes.push("User App installs target pre-created repos; connect a generated-repo account to create user repos.");
  }
  return notes;
}

function hasScope(scopes: string[], permission: string, level: "read" | "write"): boolean {
  if (scopes.includes(`${permission}:${level}`)) return true;
  if (level === "read" && scopes.includes(`${permission}:write`)) return true;
  return false;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
