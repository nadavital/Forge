import { promises as fs } from "fs";
import path from "path";
import seed from "@/data/seed.json";
import type { ForgeStore } from "@/lib/db/types";

const STORE_DIR = path.join(process.cwd(), ".forge-data");
const STORE_PATH = path.join(STORE_DIR, "store.json");

let memoryStore: ForgeStore | null = null;

function cloneSeed(): ForgeStore {
  return structuredClone(seed) as ForgeStore;
}

async function ensureStoreFile(): Promise<ForgeStore> {
  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
    const raw = await fs.readFile(STORE_PATH, "utf8");
    memoryStore = JSON.parse(raw) as ForgeStore;
    return memoryStore;
  } catch {
    memoryStore = cloneSeed();
    await fs.writeFile(STORE_PATH, JSON.stringify(memoryStore, null, 2), "utf8");
    return memoryStore;
  }
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
  await persist(cloneSeed());
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
