import assert from "node:assert/strict";
import test from "node:test";
import { opportunityStatusForPreferenceEvent } from "./preference-event-status.ts";

test("preference event review actions map to opportunity statuses", () => {
  assert.equal(opportunityStatusForPreferenceEvent("approved"), "building");
  assert.equal(opportunityStatusForPreferenceEvent("rejected"), "rejected");
  assert.equal(opportunityStatusForPreferenceEvent("ignored"), "watching");
  assert.equal(opportunityStatusForPreferenceEvent("feedback"), "researching");
});

test("non-review preference events do not mutate opportunity status", () => {
  assert.equal(opportunityStatusForPreferenceEvent("commented"), null);
});
