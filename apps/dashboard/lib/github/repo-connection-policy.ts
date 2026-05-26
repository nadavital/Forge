type Env = Partial<Record<string, string | undefined>>;

export function connectedRepoDiscoveryRequiresConnection(input: {
  repoUrl?: string | null;
  connection?: { provider?: string | null; installation_id?: string | null; status?: string | null } | null;
  env?: Env;
}): boolean {
  const env = input.env ?? process.env;
  return Boolean(
    input.repoUrl &&
      truthy(env.FORGE_REQUIRE_AUTH) &&
      (input.connection?.status !== "active" ||
        input.connection.provider !== "github_app" ||
        !input.connection.installation_id)
  );
}

export function githubConnectionCanLinkRepository(connection?: {
  provider?: string | null;
  installation_id?: string | null;
  status?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!connection) {
    return { ok: false, reason: "Choose a valid GitHub connection." };
  }
  if (connection.status !== "active") {
    return { ok: false, reason: "Reconnect this GitHub connection before linking a repository." };
  }
  if (connection.provider === "github_oauth") {
    return {
      ok: false,
      reason: "Use a GitHub App installation to link project repositories. GitHub user OAuth is only for generated repo targets."
    };
  }
  if (connection.provider === "github_app" && connection.installation_id) {
    return { ok: true };
  }
  return { ok: false, reason: "Reconnect this GitHub App installation before linking a repository." };
}

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value || "").toLowerCase());
}
