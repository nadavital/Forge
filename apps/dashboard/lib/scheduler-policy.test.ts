import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunScheduledProjectTrigger } from "./scheduler/policy.ts";

test("scheduled connected-product triggers can run without a research brief", () => {
  assert.equal(
    shouldRunScheduledProjectTrigger({ id: "project_1", mode: "connected_product" }, []),
    true
  );
});

test("scheduled new-product triggers wait until an AI brief is approved", () => {
  const project = { id: "project_1", mode: "new_product" };

  assert.equal(shouldRunScheduledProjectTrigger(project, []), false);
  assert.equal(
    shouldRunScheduledProjectTrigger(project, [
      { project_id: "project_1", status: "ready_for_research" },
      { project_id: "project_2", status: "approved" }
    ]),
    false
  );
  assert.equal(
    shouldRunScheduledProjectTrigger(project, [{ project_id: "project_1", status: "approved" }]),
    true
  );
});
