export type SupabaseRealtimeConfig = {
  url: string;
  anonKey: string;
  accessToken: string;
};

export type SupabaseRealtimeBaseConfig = Pick<SupabaseRealtimeConfig, "url" | "anonKey">;

export type SupabaseRealtimePostgresChange = {
  event: "*";
  schema: "public";
  table: string;
  filter: string;
};

export const PROJECT_STATUS_REALTIME_TABLES = [
  "pipeline_runs",
  "idea_conversations",
  "research_briefs",
  "agent_tasks",
  "opportunities",
  "prototype_options",
  "mvp_builds",
  "reflection_runs"
] as const;

type Env = Partial<Record<string, string | undefined>>;

export function statusRealtimeConfigFromEnv(env: Env = process.env): SupabaseRealtimeBaseConfig | null {
  if (truthy(env.FORGE_DISABLE_SUPABASE_REALTIME)) return null;

  const url = cleanEnv(env.NEXT_PUBLIC_SUPABASE_URL) || cleanEnv(env.SUPABASE_URL);
  const anonKey = cleanEnv(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || cleanEnv(env.SUPABASE_ANON_KEY);
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function supabaseRealtimeWebSocketUrl(input: Pick<SupabaseRealtimeConfig, "url" | "anonKey">): string {
  const base = new URL(input.url);
  base.protocol = base.protocol === "http:" ? "ws:" : "wss:";
  base.pathname = "/realtime/v1/websocket";
  base.search = "";
  base.searchParams.set("apikey", input.anonKey);
  base.searchParams.set("vsn", "1.0.0");
  return base.toString();
}

export function projectStatusRealtimeTopic(projectId: string): string {
  return `realtime:forge-project-status:${safeTopicPart(projectId)}`;
}

export function projectStatusPostgresChanges(projectId: string): SupabaseRealtimePostgresChange[] {
  const filter = `project_id=eq.${safeFilterValue(projectId)}`;
  return PROJECT_STATUS_REALTIME_TABLES.map((table) => ({
    event: "*",
    schema: "public",
    table,
    filter
  }));
}

export function projectStatusRealtimeJoinPayload(projectId: string, accessToken: string): {
  access_token: string;
  config: {
    broadcast: { ack: false; self: false };
    presence: { key: string };
    postgres_changes: SupabaseRealtimePostgresChange[];
  };
} {
  return {
    access_token: accessToken,
    config: {
      broadcast: { ack: false, self: false },
      presence: { key: "" },
      postgres_changes: projectStatusPostgresChanges(projectId)
    }
  };
}

export function isSupabasePostgresChangeMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.event === "postgres_changes";
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value || "").toLowerCase());
}

function safeTopicPart(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%/g, "_");
}

function safeFilterValue(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : encodeURIComponent(trimmed);
}
