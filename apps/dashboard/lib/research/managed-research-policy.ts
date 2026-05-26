type Env = Partial<Record<string, string | undefined>>;

export const MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE =
  "Hosted brief research requires FORGE_MANAGED_RESEARCH_URL and FORGE_MANAGED_RESEARCH_SECRET before market-research agents can run.";

export function hostedBriefResearchRequiresManagedBackend(env: Env = process.env): boolean {
  return truthy(env.FORGE_REQUIRE_AUTH);
}

export function managedBriefResearchBackendConfigured(env: Env = process.env): boolean {
  return Boolean(env.FORGE_MANAGED_RESEARCH_URL?.trim() && env.FORGE_MANAGED_RESEARCH_SECRET?.trim());
}

export function assertManagedBriefResearchReady(input: { env?: Env } = {}): void {
  const env = input.env ?? process.env;
  if (hostedBriefResearchRequiresManagedBackend(env) && !managedBriefResearchBackendConfigured(env)) {
    throw new Error(MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE);
  }
}

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value || "").toLowerCase());
}
