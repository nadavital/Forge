type Env = Partial<Record<string, string | undefined>>;

export type RuntimeSetupReference = {
  label: string;
  value: string;
  proof?: RuntimeSetupProof;
};

export type RuntimeSetupProof = {
  kind: "runtime_health" | "callback_flow";
  uncheckedLabel: string;
  provedLabel: string;
  notProvedLabel: string;
};

export function runtimeSetupReferences(capabilityId: string, env: Env = process.env): RuntimeSetupReference[] {
  const appUrl = runtimePublicAppUrl(env);
  if (!appUrl) return [];

  if (capabilityId === "user_session") {
    return [
      {
        label: "Supabase Auth redirect URL",
        value: `${appUrl}/auth/callback`,
        proof: {
          kind: "runtime_health",
          uncheckedLabel: "Not checked yet; sign in, then run live-path checks.",
          provedLabel: "Signed-in Supabase session proved.",
          notProvedLabel: "Not proved until a valid signed-in session reaches Forge."
        }
      },
      {
        label: "Forge email signup URL",
        value: `${appUrl}/signup`,
        proof: {
          kind: "callback_flow",
          uncheckedLabel: "Open this to start the email account flow.",
          provedLabel: "Email account flow completed.",
          notProvedLabel: "Complete an email magic-link signup or sign-in to prove this flow."
        }
      }
    ];
  }
  if (capabilityId === "pipeline_worker") {
    return [
      {
        label: "Worker endpoint URL",
        value: `${appUrl}/api/pipeline/worker`,
        proof: {
          kind: "runtime_health",
          uncheckedLabel: "Not checked yet; run live-path checks.",
          provedLabel: "Bearer worker probe accepted.",
          notProvedLabel: "Not proved until the bearer probe reaches the worker."
        }
      }
    ];
  }
  if (capabilityId === "github_app") {
    return [
      {
        label: "GitHub setup/OAuth callback URL",
        value: `${appUrl}/github/callback`,
        proof: {
          kind: "callback_flow",
          uncheckedLabel: "Configured URL only; complete a GitHub install or OAuth callback to prove it.",
          provedLabel: "GitHub callback completed.",
          notProvedLabel: "Not proved by webhook ping; complete the GitHub callback flow."
        }
      },
      {
        label: "GitHub webhook URL",
        value: `${appUrl}/api/github/webhook`,
        proof: {
          kind: "runtime_health",
          uncheckedLabel: "Not checked yet; run live-path checks.",
          provedLabel: "Signed GitHub webhook ping accepted.",
          notProvedLabel: "Not proved until the signed webhook ping is accepted."
        }
      }
    ];
  }
  if (capabilityId === "managed_builder") {
    return [
      {
        label: "GitHub OAuth callback URL",
        value: `${appUrl}/github/callback`,
        proof: {
          kind: "callback_flow",
          uncheckedLabel: "Configured URL only; complete GitHub OAuth to prove token storage.",
          provedLabel: "GitHub OAuth callback completed.",
          notProvedLabel: "Not proved until GitHub OAuth completes and stores a scoped token."
        }
      }
    ];
  }

  return [];
}

export function runtimePublicAppUrl(env: Env = process.env): string | null {
  const raw = env.FORGE_PUBLIC_APP_URL || env.NEXT_PUBLIC_FORGE_APP_URL;
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
