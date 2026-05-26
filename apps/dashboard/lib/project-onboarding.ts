import type { DbProject, DbSourceConfig, DbTrigger, DbUserPreference, JsonObject } from "./db/types";
import type { ProjectMode } from "../types/forge";

export type GithubRepository = {
  owner: string;
  repo: string;
  repoUrl: string;
};

export type ProjectOnboardingChecklistItem = {
  id: string;
  label: string;
  description: string;
  complete: boolean;
};

export type ProjectDefaultsInput = {
  projectId: string;
  mode: ProjectMode;
  name: string;
  repoUrl?: string | null;
  githubConnectionRequired?: boolean;
  productUrl?: string | null;
  description?: string | null;
  markets?: string[];
  riskTolerance?: string;
  notes?: string | null;
  scheduleCadence?: string | null;
  now?: string;
  idFactory: (prefix: string) => string;
};

export type ProjectDefaults = {
  project: DbProject;
  sources: DbSourceConfig[];
  triggers: DbTrigger[];
  preference: DbUserPreference;
};

export function normalizeGithubRepository(value?: string | null): GithubRepository | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const sshMatch = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return githubRepository(sshMatch[1], sshMatch[2]);
  }

  const shorthandMatch = raw.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (shorthandMatch && !raw.includes("://")) {
    return githubRepository(shorthandMatch[1], shorthandMatch[2]);
  }

  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) {
      return null;
    }
    return githubRepository(owner, repo);
  } catch {
    return null;
  }
}

export function githubSourcePatch(repoUrl?: string | null): Pick<DbSourceConfig, "name" | "status" | "config"> | null {
  const github = normalizeGithubRepository(repoUrl);
  if (!github) {
    return null;
  }

  return {
    name: `${github.owner}/${github.repo}`,
    status: "active",
    config: {
      repo_url: github.repoUrl,
      owner: github.owner,
      repo: github.repo,
      ingest: ["issues", "pull_requests"]
    }
  };
}

export function buildProjectDefaults(input: ProjectDefaultsInput): ProjectDefaults {
  const now = input.now ?? new Date().toISOString();
  const github = normalizeGithubRepository(input.repoUrl);
  const githubStatus = github && !input.githubConnectionRequired ? "active" : "paused";
  const description = clean(input.description);
  const productUrl = clean(input.productUrl);
  const schedule = scheduleDefaults(input.scheduleCadence);

  const project: DbProject = {
    id: input.projectId,
    name: input.name.trim(),
    mode: input.mode,
    stage: input.mode === "connected_product" ? "launched" : "idea",
    description,
    repo_url: github?.repoUrl ?? null,
    product_url: productUrl,
    created_at: now,
    updated_at: now
  };

  const sources: DbSourceConfig[] = [
    {
      id: input.idFactory("src"),
      project_id: input.projectId,
      source_type: "manual",
      name: "Manual ideas",
      status: "active",
      config: { origin: "project_onboarding" }
    },
    {
      id: input.idFactory("src"),
      project_id: input.projectId,
      source_type: "github",
      name: github ? `${github.owner}/${github.repo}` : "GitHub repository",
      status: githubStatus,
      config: github
        ? {
            repo_url: github.repoUrl,
            owner: github.owner,
            repo: github.repo,
            ingest: ["issues", "pull_requests"],
            ...(input.githubConnectionRequired ? { needs_connection: true } : {})
          }
        : { needs_connection: true }
    }
  ];

  if (input.mode === "connected_product") {
    sources.push({
      id: input.idFactory("src"),
      project_id: input.projectId,
      source_type: "feedback_form",
      name: "Customer feedback",
      status: "paused",
      config: { needs_connection: true }
    });
  }

  const triggers: DbTrigger[] = [
    {
      id: input.idFactory("trg"),
      project_id: input.projectId,
      name: "Manual review",
      trigger_type: "manual",
      status: "active",
      config: { origin: "project_onboarding" }
    },
    {
      id: input.idFactory("trg"),
      project_id: input.projectId,
      name: "Dream review",
      trigger_type: "schedule",
      status: schedule.status,
      config: {
        timezone: "America/Los_Angeles",
        cadence: schedule.cadence,
        interval_hours: schedule.intervalHours
      }
    }
  ];

  return {
    project,
    sources,
    triggers,
    preference: {
      id: input.idFactory("pref"),
      project_id: input.projectId,
      preferred_markets: normalizeMarkets(input.markets, input.mode),
      risk_tolerance: input.riskTolerance || (input.mode === "connected_product" ? "medium" : "low"),
      notes: clean(input.notes) || defaultPreferenceNotes(input.mode)
    }
  };
}

export function buildOnboardingChecklist(input: {
  project: DbProject;
  sources: DbSourceConfig[];
  triggers: DbTrigger[];
  preference?: DbUserPreference;
}): ProjectOnboardingChecklistItem[] {
  const githubSource = input.sources.find((source) => source.source_type === "github");
  const manualSource = input.sources.find((source) => source.source_type === "manual");
  const isNewProduct = input.project.mode === "new_product";

  return [
    {
      id: "context",
      label: "Project context",
      description: "Name the product and the problem space Forge should evaluate.",
      complete: Boolean(clean(input.project.description))
    },
    {
      id: "github",
      label: isNewProduct ? "Build repository" : "GitHub repository",
      description: isNewProduct
        ? "A generated repo is only needed after an approved build direction."
        : "Link a GitHub App installation before treating the repo as fully connected.",
      complete:
        isNewProduct ||
        Boolean(
          githubSource?.connection_id &&
            normalizeGithubRepository(input.project.repo_url || stringConfig(githubSource.config, "repo_url"))
        )
    },
    {
      id: "manual",
      label: "Manual ideas",
      description: "Keep a human-entered idea source available for early evidence.",
      complete: manualSource?.status === "active"
    },
    {
      id: "triggers",
      label: "Review trigger",
      description: "Use manual review first, then enable scheduled runs when the sources are credible.",
      complete: input.triggers.some((trigger) => trigger.status === "active")
    },
    {
      id: "taste",
      label: "Taste profile",
      description: "Capture markets, risk tolerance, and product-quality notes.",
      complete: Boolean(input.preference?.preferred_markets?.length || clean(input.preference?.notes))
    }
  ];
}

export function onboardingStatus(items: ProjectOnboardingChecklistItem[]): "complete" | "needs_setup" {
  return items.every((item) => item.complete) ? "complete" : "needs_setup";
}

export function sourceStatusForSettings(
  source: Pick<DbSourceConfig, "source_type" | "connection_id" | "config">,
  requestedStatus: string
): string {
  if (
    requestedStatus === "active" &&
    source.source_type === "github" &&
    !source.connection_id &&
    source.config?.needs_connection === true
  ) {
    return "paused";
  }
  return requestedStatus;
}

function githubRepository(owner: string, repo: string): GithubRepository | null {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim().replace(/\.git$/i, "");
  if (!cleanOwner || !cleanRepo) {
    return null;
  }
  return {
    owner: cleanOwner,
    repo: cleanRepo,
    repoUrl: `https://github.com/${cleanOwner}/${cleanRepo}`
  };
}

function normalizeMarkets(markets: string[] | undefined, mode: ProjectMode): string[] {
  const cleaned = markets?.map((market) => market.trim()).filter(Boolean) ?? [];
  if (cleaned.length > 0) {
    return cleaned;
  }
  if (mode === "connected_product") {
    return ["Existing product", "Developer tools"];
  }
  return ["New market"];
}

function defaultPreferenceNotes(mode: ProjectMode): string {
  if (mode === "connected_product") {
    return "Start with repo evidence and manual ideas before enabling scheduled reviews.";
  }
  return "Start with manual ideas and taste notes until the loop feels right.";
}

function scheduleDefaults(value?: string | null): { status: string; cadence: string; intervalHours: number } {
  if (value === "paused") return { status: "paused", cadence: "paused", intervalHours: 24 };
  if (value === "twice_daily") return { status: "active", cadence: "twice_daily", intervalHours: 12 };
  if (value === "weekly") return { status: "active", cadence: "weekly", intervalHours: 168 };
  return { status: "active", cadence: "daily", intervalHours: 24 };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringConfig(config: JsonObject | undefined, key: string): string {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}
