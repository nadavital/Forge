import type { ForgeStore, JsonObject } from "@/lib/db/types";

type SupabaseClient = {
  select<T>(table: keyof ForgeStore, query: string): Promise<T[]>;
  insert<T extends JsonObject>(table: keyof ForgeStore, row: T): Promise<T>;
  update<T extends JsonObject>(table: keyof ForgeStore, id: string, patch: T, idColumn?: string): Promise<T>;
  delete(table: keyof ForgeStore, query: string): Promise<void>;
};

export function createSupabaseClient(): SupabaseClient | null {
  if (forcedLocalStorage()) {
    return null;
  }

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return {
    async select<T>(table: keyof ForgeStore, query: string): Promise<T[]> {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase select failed for ${table}: ${response.status} ${body}`);
      }

      const payload: unknown = await response.json();
      return Array.isArray(payload) ? (payload as T[]) : [];
    },

    async insert<T extends JsonObject>(table: keyof ForgeStore, row: T): Promise<T> {
      const response = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(row)
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase insert failed for ${table}: ${response.status} ${body}`);
      }

      const payload: unknown = await response.json();
      if (Array.isArray(payload) && payload[0]) {
        return payload[0] as T;
      }
      return row;
    },

    async update<T extends JsonObject>(
      table: keyof ForgeStore,
      id: string,
      patch: T,
      idColumn = "id"
    ): Promise<T> {
      const response = await fetch(`${url}/rest/v1/${table}?${idColumn}=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase update failed for ${table}: ${response.status} ${body}`);
      }

      const payload: unknown = await response.json();
      if (Array.isArray(payload) && payload[0]) {
        return payload[0] as T;
      }
      return patch;
    },

    async delete(table: keyof ForgeStore, query: string): Promise<void> {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        }
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase delete failed for ${table}: ${response.status} ${body}`);
      }
    }
  };
}

export function isSupabaseConfigured(): boolean {
  if (forcedLocalStorage()) {
    return false;
  }
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function forcedLocalStorage(): boolean {
  return process.env.FORGE_STORAGE_BACKEND?.trim().toLowerCase() === "local";
}
