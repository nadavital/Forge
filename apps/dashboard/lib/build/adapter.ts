export type BuilderAdapter = "managed" | "simulated";

type Env = Partial<Record<string, string | undefined>>;

export function canUseManagedBuilderEnv(env: Env = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

export function selectBuilderAdapter(input: {
  requested?: BuilderAdapter;
  hasBuildTarget: boolean;
  env?: Env;
}): BuilderAdapter {
  const env = input.env ?? process.env;
  if (input.requested) return input.requested;
  if (env.FORGE_BUILDER_ADAPTER === "managed") return "managed";
  if (env.FORGE_BUILDER_ADAPTER === "simulated") return "simulated";
  return canUseManagedBuilderEnv(env) && input.hasBuildTarget ? "managed" : "simulated";
}
