import type { DbEvaluation, DbOpportunity, DbSignal, DbUserPreference, JsonObject } from "@/lib/db/types";

export type NewProductDiscoveryResult = {
  signals: Array<Omit<DbSignal, "id" | "project_id">>;
  opportunities: Array<
    Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
      signalIndexes: number[];
      evaluations: Array<Omit<DbEvaluation, "id" | "opportunity_id">>;
    }
  >;
};

export function discoverNewProductIdeas(input: {
  projectName: string;
  preferences?: DbUserPreference;
}): NewProductDiscoveryResult {
  const markets = input.preferences?.preferred_markets?.filter(Boolean) ?? [];
  const notes = clean(input.preferences?.notes);
  const context = `${input.projectName} ${markets.join(" ")} ${notes}`.toLowerCase();
  const profile = inferSeedProfile(context);
  const signals = seedSignals({ markets, notes, profile });
  const opportunities = seedOpportunities(profile).map((opportunity) => ({
    ...opportunity,
    signalIndexes: opportunity.signalIndexes.filter((index) => index < signals.length)
  }));

  return {
    signals,
    opportunities
  };
}

function inferSeedProfile(context: string): "daily_consumer" | "developer_tools" | "robotics_media" {
  if (includesAny(context, ["consumer", "daily", "reader", "news", "habit", "personal"])) {
    return "daily_consumer";
  }
  if (includesAny(context, ["robot", "drone", "vision", "audio", "epub", "research", "simulation"])) {
    return "robotics_media";
  }
  return "developer_tools";
}

function seedSignals(input: {
  markets: string[];
  notes: string;
  profile: "daily_consumer" | "developer_tools" | "robotics_media";
}): Array<Omit<DbSignal, "id" | "project_id">> {
  const markets = input.markets.length ? input.markets.join(", ") : "AI tools, local-first software, technical demos";
  const notes = input.notes || "No specific idea supplied; seed from the individual builder profile and demo constraints.";

  const profileSignal = {
    developer_tools:
      "Solo builder profile: strong fit for local-first AI/devtool workflows that can be demoed without paid APIs.",
    robotics_media:
      "Portfolio context suggests robotics, computer vision, ML systems, and media automation are credible idea territories.",
    daily_consumer:
      "Preference context favors quiet daily-use products where agent work is hidden behind a simple user experience."
  }[input.profile];

  return [
    {
      source: "manual_preference",
      title: `Preferred markets: ${markets}`,
      body: notes
    },
    {
      source: "builder_profile",
      title: profileSignal,
      body: "Generated as a Forge seed signal for a new-product run where the user does not yet know what to build."
    },
    {
      source: "demo_constraint",
      title: "Demo MVP should be local-first, narrow, and buildable without paid APIs or production deploys.",
      body: "This constraint is part of Forge's generated MVP contract."
    }
  ];
}

function seedOpportunities(profile: "daily_consumer" | "developer_tools" | "robotics_media") {
  if (profile === "daily_consumer") {
    return [
      makeOpportunity({
        title: "Personal issue steering desk",
        problem: "People want to steer what their daily read covers without learning the research machinery behind it.",
        targetUser: "Single-user daily readers and builders dogfooding a personal news workflow",
        mvpConcept: "A quiet ask box that turns one user question into a source-backed section for the next daily issue.",
        score: 88,
        rationale: "Matches daily-use preferences and can be tested without paid APIs.",
        signalIndexes: [0, 1, 2],
        profile: { seed_profile: profile, wedge: "daily habit" }
      }),
      makeOpportunity({
        title: "Decision-only morning queue",
        problem: "Builders lose energy when idea tools produce long research dumps instead of one clear decision.",
        targetUser: "Solo founders reviewing product ideas before work",
        mvpConcept: "A morning queue that shows one recommendation, evidence, tradeoff, and next action per idea.",
        score: 84,
        rationale: "Narrow workflow; useful for a Forge dogfood demo.",
        signalIndexes: [0, 2],
        profile: { seed_profile: profile, wedge: "decision review" }
      })
    ];
  }

  if (profile === "robotics_media") {
    return [
      makeOpportunity({
        title: "Simulation run replay notebook",
        problem: "Technical builders need to explain why a model, planner, or conversion pipeline behaved a certain way.",
        targetUser: "Researchers and builders working with robotics, vision, audio, or ML experiments",
        mvpConcept: "A local notebook-style app that imports run artifacts, replays outputs, and annotates failure modes.",
        score: 90,
        rationale: "Fits the user's technical repo profile and creates a concrete visual demo.",
        signalIndexes: [0, 1, 2],
        profile: { seed_profile: profile, wedge: "experiment replay" }
      }),
      makeOpportunity({
        title: "Artifact preflight checker",
        problem: "Long-running technical conversions and model demos fail late because inputs, dependencies, or assumptions are wrong.",
        targetUser: "Solo builders running media, CV, or simulation pipelines locally",
        mvpConcept: "A preflight UI that checks inputs, dependencies, sample outputs, and warnings before the full run starts.",
        score: 87,
        rationale: "Local-first, buildable, and broadly useful across the user's project types.",
        signalIndexes: [1, 2],
        profile: { seed_profile: profile, wedge: "preflight" }
      })
    ];
  }

  return [
    makeOpportunity({
      title: "Local agent build reviewer",
      problem: "Builders using coding agents need fast feedback on whether generated MVP work actually meets the brief.",
      targetUser: "Solo developers reviewing agent-generated prototypes",
      mvpConcept:
        "A local reviewer that checks README, smoke tests, free-service usage, and PR contract compliance for a generated MVP.",
      score: 91,
      rationale: "Directly supports the user's Forge workflow and is demoable without external services.",
      signalIndexes: [0, 1, 2],
      profile: { seed_profile: profile, wedge: "agent build QA" }
    }),
    makeOpportunity({
      title: "Repo-to-demo launcher",
      problem: "Useful repos often fail to communicate a working demo path quickly enough for evaluators or collaborators.",
      targetUser: "Developers sharing technical projects",
      mvpConcept: "A local app that inspects a repo, finds demo commands, runs smoke checks, and produces a shareable demo card.",
      score: 88,
      rationale: "Strong fit with connected repo demos and local-first constraints.",
      signalIndexes: [1, 2],
      profile: { seed_profile: profile, wedge: "repo demo" }
    }),
    makeOpportunity({
      title: "Tiny eval case generator",
      problem: "Prototype ideas are hard to compare when each one has different, informal success criteria.",
      targetUser: "Solo founders and builders deciding what to prototype",
      mvpConcept: "A small tool that turns an idea brief into three smoke tests, three failure cases, and a build/no-build rubric.",
      score: 84,
      rationale: "Complements Forge's decision loop while staying small enough for a demo MVP.",
      signalIndexes: [0, 2],
      profile: { seed_profile: profile, wedge: "idea evaluation" }
    })
  ];
}

function makeOpportunity(input: {
  title: string;
  problem: string;
  targetUser: string;
  mvpConcept: string;
  score: number;
  rationale: string;
  signalIndexes: number[];
  profile: JsonObject;
}) {
  return {
    title: input.title,
    problem: input.problem,
    target_user: input.targetUser,
    mvp_concept: input.mvpConcept,
    score: input.score,
    score_rationale: input.rationale,
    status: "proposed",
    profile: input.profile,
    signalIndexes: input.signalIndexes,
    evaluations: [
      {
        evaluator: "taste_critic",
        content: "The idea is narrow, locally demoable, and grounded in the supplied preference/profile context.",
        scores: { usefulness: 0.84, coherence: 0.82, differentiation: 0.74 }
      },
      {
        evaluator: "bull",
        content: "The MVP is small enough to build now and provides a visible product loop for the demo.",
        scores: {}
      },
      {
        evaluator: "bear",
        content: "This is seeded from preference/profile context, not market proof; validate with prototype interaction.",
        scores: {}
      },
      {
        evaluator: "decision_agent",
        content: input.rationale,
        scores: { recommendation: "prototype", confidence: Math.min(0.9, input.score / 100) }
      }
    ]
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
