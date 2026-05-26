import assert from "node:assert/strict";
import test from "node:test";
import { projectPrimaryAction } from "./project-primary-action.ts";
import type { IdeaConversationView, MorningReviewProject } from "@/types/forge";

test("connected products keep the direct Dream run action", () => {
  assert.deepEqual(projectPrimaryAction(project("connected_product")), {
    kind: "run",
    label: "Dream now",
    pendingLabel: "Dreaming...",
    pendingStatus: "Starting staged run: collect -> research -> Bull/Bear -> synthesize"
  });
});

test("connected products with an unlinked hosted repo route to GitHub setup first", () => {
  assert.deepEqual(projectPrimaryAction(project("connected_product", { needsGitHubConnection: true })), {
    kind: "setup",
    href: "/projects/project_1/settings",
    label: "Connect GitHub",
    status: "Hosted connected-product research needs a scoped GitHub App connection first."
  });
});

test("new-product projects without a brief route the header action to AI idea intake", () => {
  assert.deepEqual(projectPrimaryAction(project("new_product"), null), {
    kind: "conversation",
    href: "#idea-intake-heading",
    label: "Explore idea",
    status: "New-product research starts from your AI idea conversation."
  });
});

test("new-product projects route ready and approved briefs through the conversation panel", () => {
  assert.equal(
    projectPrimaryAction(project("new_product"), conversation("ready_for_research")).label,
    "Review brief"
  );
  assert.equal(projectPrimaryAction(project("new_product"), conversation("approved")).label, "Start research");
});

test("queued new-product research does not expose a duplicate generic Dream action", () => {
  const action = projectPrimaryAction(project("new_product"), {
    ...conversation("approved"),
    latestResearchRun: {
      id: "run_1",
      status: "queued"
    }
  });

  assert.equal(action.kind, "conversation");
  assert.equal(action.label, "View research");
});

function project(
  modeKey: MorningReviewProject["modeKey"],
  overrides: Partial<Pick<MorningReviewProject, "needsGitHubConnection">> = {}
): Pick<MorningReviewProject, "id" | "modeKey" | "needsGitHubConnection"> {
  return { id: "project_1", modeKey, needsGitHubConnection: false, ...overrides };
}

function conversation(status: NonNullable<IdeaConversationView["latestBrief"]>["status"]): IdeaConversationView {
  return {
    id: "conv_1",
    title: "Idea",
    status: "active",
    messages: [],
    latestBrief: {
      id: "brief_1",
      status,
      hypothesis: "Test hypothesis",
      targetUsers: [],
      painArea: "",
      constraints: [],
      sourcePlan: [],
      disqualifyingEvidence: [],
      mvpBoundaries: [],
      userTasteNotes: [],
      openQuestions: []
    },
    agentTasks: []
  };
}
