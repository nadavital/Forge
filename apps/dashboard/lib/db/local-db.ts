import { promises as fs } from "fs";
import path from "path";
import type { ForgeStore } from "@/lib/db/types";

const STORE_DIR = process.env.FORGE_LOCAL_STORE_DIR
  ? path.resolve(process.env.FORGE_LOCAL_STORE_DIR)
  : path.join(process.cwd(), ".forge-data");
const STORE_PATH = path.join(STORE_DIR, "store.json");

let memoryStore: ForgeStore | null = null;

function emptyStore(): ForgeStore {
  return {
    users: [],
    workspaces: [],
    workspace_members: [],
    user_auth_identities: [],
    projects: [],
    github_connections: [],
    github_user_tokens: [],
    source_configs: [],
    triggers: [],
    user_preferences: [],
    preference_events: [],
    pipeline_runs: [],
    idea_conversations: [],
    idea_messages: [],
    research_briefs: [],
    agent_tasks: [],
    signals: [],
    opportunities: [],
    opportunity_signals: [],
    opportunity_evaluations: [],
    prototype_options: [],
    mvp_builds: [],
    build_artifacts: [],
    reflection_runs: [],
    reflection_proposals: []
  };
}

async function ensureStoreFile(): Promise<ForgeStore> {
  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
    const raw = await fs.readFile(STORE_PATH, "utf8");
    memoryStore = normalizeStore(JSON.parse(raw) as Partial<ForgeStore>);
    if (isLegacyFixtureStore(memoryStore)) {
      memoryStore = emptyStore();
      await persist(memoryStore);
    } else {
      await persist(memoryStore);
    }
    return memoryStore;
  } catch {
    memoryStore = emptyStore();
    await fs.writeFile(STORE_PATH, JSON.stringify(memoryStore, null, 2), "utf8");
    return memoryStore;
  }
}

function normalizeStore(value: Partial<ForgeStore>): ForgeStore {
  const empty = emptyStore();
  return {
    ...empty,
    ...value,
    users: Array.isArray(value.users) ? value.users : empty.users,
    workspaces: Array.isArray(value.workspaces) ? value.workspaces : empty.workspaces,
    workspace_members: Array.isArray(value.workspace_members) ? value.workspace_members : empty.workspace_members,
    user_auth_identities: Array.isArray(value.user_auth_identities)
      ? value.user_auth_identities
      : empty.user_auth_identities,
    projects: Array.isArray(value.projects) ? value.projects : empty.projects,
    github_connections: Array.isArray(value.github_connections) ? value.github_connections : empty.github_connections,
    github_user_tokens: Array.isArray(value.github_user_tokens) ? value.github_user_tokens : empty.github_user_tokens,
    source_configs: Array.isArray(value.source_configs) ? value.source_configs : empty.source_configs,
    triggers: Array.isArray(value.triggers) ? value.triggers : empty.triggers,
    user_preferences: Array.isArray(value.user_preferences) ? value.user_preferences : empty.user_preferences,
    preference_events: Array.isArray(value.preference_events) ? value.preference_events : empty.preference_events,
    pipeline_runs: Array.isArray(value.pipeline_runs) ? value.pipeline_runs : empty.pipeline_runs,
    idea_conversations: Array.isArray(value.idea_conversations) ? value.idea_conversations : empty.idea_conversations,
    idea_messages: Array.isArray(value.idea_messages) ? value.idea_messages : empty.idea_messages,
    research_briefs: Array.isArray(value.research_briefs) ? value.research_briefs : empty.research_briefs,
    agent_tasks: Array.isArray(value.agent_tasks) ? value.agent_tasks : empty.agent_tasks,
    signals: Array.isArray(value.signals) ? value.signals : empty.signals,
    opportunities: Array.isArray(value.opportunities) ? value.opportunities : empty.opportunities,
    opportunity_signals: Array.isArray(value.opportunity_signals)
      ? value.opportunity_signals
      : empty.opportunity_signals,
    opportunity_evaluations: Array.isArray(value.opportunity_evaluations)
      ? value.opportunity_evaluations
      : empty.opportunity_evaluations,
    prototype_options: Array.isArray(value.prototype_options) ? value.prototype_options : empty.prototype_options,
    mvp_builds: Array.isArray(value.mvp_builds) ? value.mvp_builds : empty.mvp_builds,
    build_artifacts: Array.isArray(value.build_artifacts) ? value.build_artifacts : empty.build_artifacts,
    reflection_runs: Array.isArray(value.reflection_runs) ? value.reflection_runs : empty.reflection_runs,
    reflection_proposals: Array.isArray(value.reflection_proposals)
      ? value.reflection_proposals
      : empty.reflection_proposals
  };
}

function isLegacyFixtureStore(store: ForgeStore): boolean {
  const projectIds = store.projects.map((project) => project.id).sort();
  return (
    projectIds.length === 2 &&
    projectIds[0] === "acme" &&
    projectIds[1] === "petal" &&
    store.pipeline_runs.some((run) => run.id === "acme-run-1") &&
    store.pipeline_runs.some((run) => run.id === "petal-run-1")
  );
}

async function persist(store: ForgeStore): Promise<void> {
  memoryStore = store;
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function readLocalStore(): Promise<ForgeStore> {
  return ensureStoreFile();
}

export async function writeLocalStore(store: ForgeStore): Promise<void> {
  await persist(store);
}

export async function resetLocalStore(): Promise<void> {
  await persist(emptyStore());
}

export function newId(prefix: string): string {
  return crypto.randomUUID();
}
