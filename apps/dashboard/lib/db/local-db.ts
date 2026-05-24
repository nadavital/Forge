import { promises as fs } from "fs";
import path from "path";
import type { ForgeStore } from "@/lib/db/types";

const STORE_DIR = path.join(process.cwd(), ".forge-data");
const STORE_PATH = path.join(STORE_DIR, "store.json");

let memoryStore: ForgeStore | null = null;

function emptyStore(): ForgeStore {
  return {
    projects: [],
    source_configs: [],
    triggers: [],
    user_preferences: [],
    preference_events: [],
    pipeline_runs: [],
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
    memoryStore = JSON.parse(raw) as ForgeStore;
    if (isLegacyFixtureStore(memoryStore)) {
      memoryStore = emptyStore();
      await persist(memoryStore);
    }
    return memoryStore;
  } catch {
    memoryStore = emptyStore();
    await fs.writeFile(STORE_PATH, JSON.stringify(memoryStore, null, 2), "utf8");
    return memoryStore;
  }
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
