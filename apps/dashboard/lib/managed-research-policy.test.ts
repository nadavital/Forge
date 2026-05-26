import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE,
  assertManagedBriefResearchReady,
  hostedBriefResearchRequiresManagedBackend,
  managedBriefResearchBackendConfigured
} from "./research/managed-research-policy.ts";

test("hosted brief research requires the managed research backend", () => {
  assert.equal(hostedBriefResearchRequiresManagedBackend({ FORGE_REQUIRE_AUTH: "1" }), true);
  assert.equal(hostedBriefResearchRequiresManagedBackend({ FORGE_REQUIRE_AUTH: "true" }), true);
  assert.equal(hostedBriefResearchRequiresManagedBackend({ FORGE_REQUIRE_AUTH: "0" }), false);
  assert.equal(hostedBriefResearchRequiresManagedBackend({}), false);
});

test("managed brief research backend requires both url and secret", () => {
  assert.equal(
    managedBriefResearchBackendConfigured({
      FORGE_MANAGED_RESEARCH_URL: "https://research.example.com",
      FORGE_MANAGED_RESEARCH_SECRET: "secret"
    }),
    true
  );
  assert.equal(
    managedBriefResearchBackendConfigured({
      FORGE_MANAGED_RESEARCH_URL: "https://research.example.com"
    }),
    false
  );
  assert.equal(
    managedBriefResearchBackendConfigured({
      FORGE_MANAGED_RESEARCH_SECRET: "secret"
    }),
    false
  );
});

test("hosted mode fails before local brief-origin research fallback can run", () => {
  assert.throws(
    () =>
      assertManagedBriefResearchReady({
        env: {
          FORGE_REQUIRE_AUTH: "1",
          FORGE_MANAGED_RESEARCH_URL: "https://research.example.com"
        }
      }),
    new RegExp(MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE)
  );
});

test("local development can use brief-origin fallback while managed research is unconfigured", () => {
  assert.doesNotThrow(() =>
    assertManagedBriefResearchReady({
      env: {
        FORGE_REQUIRE_AUTH: "0"
      }
    })
  );
});
