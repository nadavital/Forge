import type { DbEvaluation, DbOpportunity, DbProject, DbSignal, JsonObject } from "@/lib/db/types";

export type BuildBrief = JsonObject & {
  adapter: "gemini_managed" | "simulated";
  title: string;
  problem: string;
  mvp_concept: string;
  target_user: string;
  project: {
    id: string;
    name: string;
    mode: string;
    repo_url: string | null;
  };
  build_target: {
    kind: "existing_repo_pr" | "generated_repo_with_pr";
    target_repo_url: string;
    generated_repo_owner: string;
    generated_repo_name: string;
    branch_name: string;
    pr_title: string;
    create_repo_if_missing: boolean;
  };
  template_repo_url: string;
  generated_pr_contract: {
    title_format: string;
    requires_runnable_app: true;
    requires_readme: true;
    requires_smoke_checks: true;
    no_paid_apis: true;
    no_production_deploy: true;
    document_free_external_services: true;
  };
  evidence: Array<{
    source: string;
    title: string;
    url: string | null;
  }>;
  evaluations: Array<{
    evaluator: string;
    content: string;
    scores: JsonObject | null;
  }>;
};

export function createBuildBrief(input: {
  adapter: BuildBrief["adapter"];
  opportunity: DbOpportunity;
  project: DbProject;
  evidence: DbSignal[];
  evaluations: DbEvaluation[];
}): BuildBrief {
  const title = clean(input.opportunity.title) || "Untitled opportunity";
  const target = buildTargetFor({
    project: input.project,
    opportunityTitle: title
  });

  return {
    adapter: input.adapter,
    title,
    problem: clean(input.opportunity.problem) || clean(input.opportunity.score_rationale) || "No problem statement.",
    mvp_concept: clean(input.opportunity.mvp_concept) || "Not specified.",
    target_user: clean(input.opportunity.target_user) || "Unknown target user",
    project: {
      id: input.project.id,
      name: input.project.name,
      mode: input.project.mode,
      repo_url: input.project.repo_url ?? null
    },
    build_target: target,
    template_repo_url: process.env.FORGE_TEMPLATE_REPO_URL || "https://github.com/forge-labs/mvp-template",
    generated_pr_contract: {
      title_format: `Build MVP: ${title}`,
      requires_runnable_app: true,
      requires_readme: true,
      requires_smoke_checks: true,
      no_paid_apis: true,
      no_production_deploy: true,
      document_free_external_services: true
    },
    evidence: input.evidence.map((signal) => ({
      source: clean(signal.source) || "signal",
      title: clean(signal.title) || clean(signal.body) || "Untitled signal",
      url: signal.url ?? null
    })),
    evaluations: input.evaluations.map((evaluation) => ({
      evaluator: clean(evaluation.evaluator) || "unknown",
      content: clean(evaluation.content),
      scores: evaluation.scores ?? null
    }))
  };
}

export function createManagedBuilderPrompt(brief: BuildBrief): string {
  const targetLine =
    brief.build_target.kind === "generated_repo_with_pr"
      ? `Create a new generated repo named ${brief.build_target.generated_repo_name} under ${brief.build_target.generated_repo_owner}, then open a PR against that repo.`
      : `Open a PR against the existing target repo ${brief.build_target.target_repo_url}.`;
  return [
    "Build the approved Forge MVP and prepare it for a GitHub PR.",
    "",
    `Target: ${targetLine}`,
    "Forge owns GitHub credentials server-side. Do not request, invent, or expose secrets from the sandbox.",
    "Return either PR metadata if you opened the PR yourself, or a files[] bundle so Forge can create the repo/branch/PR server-side.",
    "",
    "Priority order:",
    "1. Follow the human-approved opportunity and any project repo context.",
    "2. Stay within the MVP concept and target user in the build brief.",
    "3. Use the template repo as the starting point.",
    "4. Use code and free services only. Do not add paid APIs, production deployments, or secret-requiring integrations.",
    "",
    "Required output:",
    "- Runnable app code.",
    "- README with setup and run instructions.",
    "- Basic tests or smoke checks.",
    "- Explanation of the product MVP.",
    "- List of free external services used, if any.",
    `- Pull request title exactly: ${brief.generated_pr_contract.title_format}`,
    "",
    "When complete, return one JSON object with this shape:",
    JSON.stringify(
      {
        generated_repo_url: "https://github.com/org/repo",
        branch: "forge/opportunity-slug",
        pr_url: "https://github.com/org/repo/pull/123",
        logs: "Short build and review summary.",
        files: [
          { path: "package.json", content: "{\"scripts\":{\"dev\":\"vite --host 0.0.0.0\"}}" },
          { path: "README.md", content: "Setup, run instructions, product MVP explanation, and free services." },
          { path: "src/App.tsx", content: "Runnable app source." }
        ],
        artifacts: [
          { type: "readme", content: "README summary or URL." },
          { type: "run_instruction", content: "How to run the MVP locally." },
          { type: "test_result", content: "Smoke check output." },
          { type: "service_manifest", content: "Free services used, or none." }
        ]
      },
      null,
      2
    ),
    "",
    "Build brief:",
    JSON.stringify(brief, null, 2)
  ].join("\n");
}

function buildTargetFor(input: { project: DbProject; opportunityTitle: string }): BuildBrief["build_target"] {
  const branchName = `forge/${slugify(input.opportunityTitle)}`;
  const repoUrl = clean(input.project.repo_url);
  const owner = clean(process.env.FORGE_GENERATED_REPO_OWNER) || clean(process.env.FORGE_GITHUB_OWNER) || "forge-labs";
  const generatedRepoName = [
    "forge",
    slugify(input.project.name),
    slugify(input.opportunityTitle)
  ]
    .filter(Boolean)
    .join("-")
    .slice(0, 80);

  if (repoUrl) {
    return {
      kind: "existing_repo_pr",
      target_repo_url: repoUrl,
      generated_repo_owner: owner,
      generated_repo_name: generatedRepoName,
      branch_name: branchName,
      pr_title: `Build MVP: ${input.opportunityTitle}`,
      create_repo_if_missing: false
    };
  }

  return {
    kind: "generated_repo_with_pr",
    target_repo_url: `https://github.com/${owner}/${generatedRepoName}`,
    generated_repo_owner: owner,
    generated_repo_name: generatedRepoName,
    branch_name: branchName,
    pr_title: `Build MVP: ${input.opportunityTitle}`,
    create_repo_if_missing: true
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mvp";
}
