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

type CompactBuildBrief = {
  title: string;
  problem: string;
  mvp_concept: string;
  target_user: string;
  project: BuildBrief["project"];
  build_target: BuildBrief["build_target"];
  template_repo_url: string;
  generated_pr_contract: BuildBrief["generated_pr_contract"];
  evidence: BuildBrief["evidence"];
  evaluations: BuildBrief["evaluations"];
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
  const compact = compactBuildBrief(brief);
  const targetLine =
    brief.build_target.kind === "generated_repo_with_pr"
      ? `Create a new generated repo named ${brief.build_target.generated_repo_name} under ${brief.build_target.generated_repo_owner}, then open a PR against that repo.`
      : `Open a PR against the existing target repo ${brief.build_target.target_repo_url}.`;
  const filesOnly =
    brief.build_target.kind === "existing_repo_pr" || process.env.FORGE_MANAGED_BUILDER_FILES_ONLY === "1";

  return [
    "Build the approved Forge MVP as a small file bundle for a GitHub PR.",
    "",
    `Target: ${targetLine}`,
    "Forge owns GitHub credentials server-side. Do not request, invent, or expose secrets from the sandbox.",
    filesOnly
      ? "Return files[] only. Forge will create the branch and PR server-side after validating your files."
      : "Return either PR metadata if you opened the PR yourself, or a files[] bundle so Forge can create the repo/branch/PR server-side.",
    "Do not use sandbox tools, run shell commands, install dependencies, inspect files, or test the app. Generate the file bundle directly from the build brief.",
    "Do not inspect or summarize the whole target repository. Keep the MVP isolated under the Forge-scoped path that the server will apply.",
    "Keep the response small: no more than 5 files, no screenshots, and no file over 4000 characters.",
    "Prefer a tiny static React/Vite prototype plus README and smoke-check instructions.",
    "",
    "Priority order:",
    "1. Follow the human-approved opportunity.",
    "2. Stay within the MVP concept and target user in the build brief.",
    "3. Generate the smallest runnable prototype that proves the product wedge.",
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
        logs: "Short build and review summary.",
        summary: "What was built and how it satisfies the MVP.",
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
    "Compact build brief:",
    JSON.stringify(compact, null, 2)
  ].join("\n");
}

export function compactBuildBrief(brief: BuildBrief): CompactBuildBrief {
  return {
    title: truncate(brief.title, 160),
    problem: truncate(brief.problem, 700),
    mvp_concept: truncate(brief.mvp_concept, 900),
    target_user: truncate(brief.target_user, 240),
    project: brief.project,
    build_target: brief.build_target,
    template_repo_url: brief.template_repo_url,
    generated_pr_contract: brief.generated_pr_contract,
    evidence: brief.evidence.slice(0, 4).map((item) => ({
      source: truncate(item.source, 80),
      title: truncate(item.title, 240),
      url: item.url
    })),
    evaluations: brief.evaluations.slice(0, 4).map((evaluation) => ({
      evaluator: truncate(evaluation.evaluator, 80),
      content: truncate(evaluation.content, 700),
      scores: evaluation.scores
    }))
  };
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

function truncate(value: string, max: number): string {
  const cleanValue = clean(value);
  return cleanValue.length > max ? `${cleanValue.slice(0, max - 1)}…` : cleanValue;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mvp";
}
