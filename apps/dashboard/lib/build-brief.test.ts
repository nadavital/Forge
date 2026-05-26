import assert from "node:assert/strict";
import test from "node:test";
import { createBuildBrief, createManagedBuilderPrompt } from "./build/brief.ts";
import type { DbEvaluation, DbOpportunity, DbProject } from "./db/types.ts";

test("build briefs carry linked GitHub connection ids for existing-repo PR targets", () => {
  const project: DbProject = {
    id: "project_1",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    name: "Forge",
    mode: "connected_product",
    repo_url: "https://github.com/acme/forge"
  };
  const opportunity: DbOpportunity = {
    id: "opp_1",
    project_id: project.id,
    title: "Research intake cockpit",
    problem: "Founders need a better way to shape ideas before research.",
    target_user: "Solo founders",
    mvp_concept: "AI-led idea conversation that compiles a research brief."
  };

  const brief = createBuildBrief({
    adapter: "gemini_managed",
    project,
    opportunity,
    githubConnectionId: "gh_123",
    evidence: [],
    evaluations: []
  });

  assert.equal(brief.build_target.kind, "existing_repo_pr");
  assert.equal(brief.build_target.target_repo_url, "https://github.com/acme/forge");
  assert.equal(brief.build_target.github_connection_id, "gh_123");
});

test("generated-repo build briefs do not pretend to have a project GitHub connection", () => {
  const project: DbProject = {
    id: "project_2",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    name: "New Forge Idea",
    mode: "new_product"
  };
  const opportunity: DbOpportunity = {
    id: "opp_2",
    project_id: project.id,
    title: "Signal digest",
    problem: "Teams miss weak market signals.",
    target_user: "Product teams",
    mvp_concept: "Daily digest of sourced product pains."
  };

  const brief = createBuildBrief({
    adapter: "simulated",
    project,
    opportunity,
    evidence: [],
    evaluations: []
  });

  assert.equal(brief.build_target.kind, "generated_repo_with_pr");
  assert.equal(brief.build_target.github_connection_id, null);
  assert.equal(brief.build_target.create_repo_if_missing, true);
});

test("generated-repo build briefs can target a pre-created GitHub App repo", () => {
  const project: DbProject = {
    id: "project_3",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    name: "New Forge Idea",
    mode: "new_product"
  };
  const opportunity: DbOpportunity = {
    id: "opp_3",
    project_id: project.id,
    title: "Signal digest",
    problem: "Teams miss weak market signals.",
    target_user: "Product teams",
    mvp_concept: "Daily digest of sourced product pains."
  };

  const brief = createBuildBrief({
    adapter: "gemini_managed",
    project,
    opportunity,
    githubConnectionId: "gh_generated",
    githubConnectionAccountLogin: "acme-labs",
    evidence: [],
    evaluations: []
  });

  assert.equal(brief.build_target.kind, "generated_repo_with_pr");
  assert.equal(brief.build_target.github_connection_id, "gh_generated");
  assert.equal(brief.build_target.generated_repo_owner, "acme-labs");
  assert.equal(brief.build_target.create_repo_if_missing, false);
  assert.match(brief.build_target.target_repo_url, /^https:\/\/github\.com\/acme-labs\//);
});

test("generated-repo build briefs allow GitHub App org repo creation when the target can create repos", () => {
  const project: DbProject = {
    id: "project_4",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    name: "New Forge Idea",
    mode: "new_product"
  };
  const opportunity: DbOpportunity = {
    id: "opp_4",
    project_id: project.id,
    title: "Signal digest",
    problem: "Teams miss weak market signals.",
    target_user: "Product teams",
    mvp_concept: "Daily digest of sourced product pains."
  };

  const brief = createBuildBrief({
    adapter: "gemini_managed",
    project,
    opportunity,
    githubConnectionId: "gh_generated",
    githubConnectionAccountLogin: "acme-labs",
    githubConnectionCanCreateRepos: true,
    evidence: [],
    evaluations: []
  });

  assert.equal(brief.build_target.kind, "generated_repo_with_pr");
  assert.equal(brief.build_target.github_connection_id, "gh_generated");
  assert.equal(brief.build_target.generated_repo_owner, "acme-labs");
  assert.equal(brief.build_target.create_repo_if_missing, true);
});

test("build briefs carry user notes before Synthesizer build direction", () => {
  const project: DbProject = {
    id: "project_5",
    owner_user_id: "user_1",
    workspace_id: "workspace_1",
    name: "Screenshot Planner",
    mode: "new_product"
  };
  const opportunity: DbOpportunity = {
    id: "opp_5",
    project_id: project.id,
    title: "Screenshot launch planner",
    problem: "Solo iOS developers waste launch time planning screenshot sets.",
    target_user: "Solo iOS developers",
    mvp_concept: "A checklist and copy planner for App Store screenshots."
  };
  const evaluations: DbEvaluation[] = [
    {
      id: "eval_5",
      opportunity_id: opportunity.id,
      evaluator: "synthesizer_agent",
      content: "Build a planner for screenshot launch prep.",
      scores: {
        payload: {
          product_pitch: "A practical screenshot launch planner.",
          builder_system_prompt: "Build a local-first screenshot planning prototype.",
          builder_readiness: "ready",
          mvp_scope: ["Checklist", "Copy notes"],
          non_goals: ["Automated App Store upload"]
        }
      }
    }
  ];

  const brief = createBuildBrief({
    adapter: "gemini_managed",
    project,
    opportunity,
    userPreferenceNotes: "Keep it utilitarian and local-first.",
    evidence: [],
    evaluations
  });
  const prompt = createManagedBuilderPrompt(brief);

  assert.equal(brief.user_notes, "Keep it utilitarian and local-first.");
  assert.equal(brief.synthesis?.builderSystemPrompt, "Build a local-first screenshot planning prototype.");
  assert.ok(prompt.indexOf("Keep it utilitarian and local-first.") < prompt.indexOf("Build a local-first"));
  assert.match(prompt, /Respect user preference notes before managed synthesis/);
});
