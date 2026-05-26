import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoRefreshProject } from "./realtime/refresh-policy.ts";
import {
  PROJECT_STATUS_REALTIME_TABLES,
  projectStatusPostgresChanges,
  projectStatusRealtimeJoinPayload,
  projectStatusRealtimeTopic,
  statusRealtimeConfigFromEnv,
  supabaseRealtimeWebSocketUrl
} from "./realtime/supabase-realtime.ts";
import type { MorningReviewProject } from "@/types/forge";

test("project auto-refreshes while a build is non-terminal", () => {
  assert.equal(
    shouldAutoRefreshProject({
      project: projectFixture({
        opportunities: [
          {
            id: "opp_1",
            build: { status: "building" }
          }
        ] as MorningReviewProject["opportunities"]
      })
    }),
    true
  );
});

test("project does not auto-refresh after terminal build status", () => {
  assert.equal(
    shouldAutoRefreshProject({
      project: projectFixture({
        opportunities: [
          {
            id: "opp_1",
            build: { status: "completed" }
          }
        ] as MorningReviewProject["opportunities"]
      })
    }),
    false
  );
});

test("project auto-refreshes while research tasks are running", () => {
  assert.equal(
    shouldAutoRefreshProject({
      project: projectFixture(),
      conversation: {
        id: "conv_1",
        title: "Idea",
        status: "researching",
        messages: [],
        agentTasks: [{ id: "task_1", role: "Researcher", phase: "Market research", status: "running" }]
      }
    }),
    true
  );
});

test("status realtime config exposes only Supabase URL and anon key", () => {
  assert.deepEqual(
    statusRealtimeConfigFromEnv({
      SUPABASE_URL: "https://forge.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    }),
    {
      url: "https://forge.supabase.co",
      anonKey: "anon-key"
    }
  );
  assert.equal(
    statusRealtimeConfigFromEnv({
      SUPABASE_URL: "https://forge.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      FORGE_DISABLE_SUPABASE_REALTIME: "1"
    }),
    null
  );
});

test("project status realtime subscribes to project-scoped status tables", () => {
  const changes = projectStatusPostgresChanges("project_1");

  assert.deepEqual(
    changes.map((change) => change.table),
    [...PROJECT_STATUS_REALTIME_TABLES]
  );
  assert.ok(changes.every((change) => change.filter === "project_id=eq.project_1"));
  assert.equal(projectStatusRealtimeTopic("project 1"), "realtime:forge-project-status:project_201");
  assert.deepEqual(projectStatusRealtimeJoinPayload("project_1", "access-token").config.postgres_changes, changes);
  assert.equal(projectStatusRealtimeJoinPayload("project_1", "access-token").access_token, "access-token");
});

test("supabase realtime websocket URL never includes the service-role key", () => {
  const url = supabaseRealtimeWebSocketUrl({
    url: "https://forge.supabase.co",
    anonKey: "anon-key"
  });

  assert.equal(url, "wss://forge.supabase.co/realtime/v1/websocket?apikey=anon-key&vsn=1.0.0");
  assert.doesNotMatch(url, /service-role/);
});

function projectFixture(
  overrides: Partial<MorningReviewProject> = {}
): MorningReviewProject {
  return {
    id: "project_1",
    name: "Project",
    mode: "new product",
    modeKey: "new_product",
    needsGitHubConnection: false,
    signalCount: 0,
    runStatus: "No runs yet",
    opportunities: [],
    ...overrides
  };
}
