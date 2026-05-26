import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseClient, isSupabaseConfigured } from "./db/supabase.ts";

test("repository Supabase client requires the service-role key, not only anon auth", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousBackend = process.env.FORGE_STORAGE_BACKEND;

  try {
    delete process.env.FORGE_STORAGE_BACKEND;
    process.env.SUPABASE_URL = "https://forge.supabase.test";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    assert.equal(isSupabaseConfigured(), false);
    assert.equal(createSupabaseClient(), null);

    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    assert.equal(isSupabaseConfigured(), true);
    assert.ok(createSupabaseClient());
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_ANON_KEY", previousAnon);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousService);
    restoreEnv("FORGE_STORAGE_BACKEND", previousBackend);
  }
});

test("repository Supabase client can be explicitly disabled for local fixture runs", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousBackend = process.env.FORGE_STORAGE_BACKEND;

  try {
    process.env.SUPABASE_URL = "https://forge.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.FORGE_STORAGE_BACKEND = "local";

    assert.equal(isSupabaseConfigured(), false);
    assert.equal(createSupabaseClient(), null);
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousService);
    restoreEnv("FORGE_STORAGE_BACKEND", previousBackend);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
