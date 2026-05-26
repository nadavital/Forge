import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dashboard idea conversation maps research roles to user-visible phases", () => {
  const source = readFileSync(new URL("./dashboard-data.ts", import.meta.url), "utf8");

  assert.match(source, /phase: taskPhase\(task\.agent_role\)/);
  assert.match(source, /SourceCollector"\) return "Source collection"/);
  assert.match(source, /Researcher"\) return "Market research"/);
  assert.match(source, /TasteCritic"\) return "Taste critique"/);
  assert.match(source, /BullAgent" \|\| role === "BearAgent"\) return "Bull\/Bear review"/);
  assert.match(source, /DecisionAgent"\) return "Decision"/);
  assert.match(source, /Synthesizer"\) return "Build direction"/);
});
