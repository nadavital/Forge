import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runManagedBriefResearch } from "./research/managed-research-client.ts";
import type { DbProject, DbResearchBrief } from "./db/types.ts";

test("managed brief research rejects malformed backend responses", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async () => Response.json({ status: "completed", opportunities: [] })) as typeof fetch;

    await assert.rejects(
      () =>
        runManagedBriefResearch({
          project: projectFixture(),
          researchBrief: briefFixture()
        }),
      /missing a signals array/
    );
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research keeps evaluator metadata without promoting thin evidence", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async () =>
      Response.json({
        status: "completed",
        query: "idea validation",
        evidence_summary: {
          opportunities: 1,
          build_ready_opportunities: 0,
          needs_more_evidence_opportunities: 1,
          reasons: ["Needs at least two linked public-source signals before build approval."]
        },
        media_items: [
          {
            source: "reddit",
            metadata: {
              source_plan: ["Reddit r/SaaS posts"],
              source_plan_query_hints: ["Reddit r/SaaS posts"],
              enabled_sources: ["reddit", "github"],
              subreddit: "SaaS"
            }
          },
          {
            source: "github",
            metadata: {
              source_plan: ["GitHub issues"],
              source_plan_query_hints: ["GitHub issues"],
              enabled_sources: ["reddit", "github"]
            }
          }
        ],
        signals: [
          {
            source: "reddit",
            title: "Pain",
            body: "Founders struggle to choose credible ideas.",
            url: "https://example.com/pain"
          }
        ],
        opportunities: [
          {
            title: "Idea validation coach",
            problem: "Founders struggle to choose credible ideas.",
            target_user: "solo founders",
            mvp_concept: "Conversational research brief compiler",
            score: 0.72,
            score_rationale: "One public source-backed signal.",
            source_indexes: [0],
            profile: {
              evidence_sufficient_for_build: false,
              evidence_sufficiency_reason: "Needs at least two linked public-source signals before build approval."
            },
            evaluations: [
              {
                evaluator: "bull",
                content: "The pain is specific and early MVP is narrow.",
                scores: { overall: 0.7 }
              },
              {
                evaluator: "decision_agent",
                content: "Research more before build.",
                scores: { recommendation: "research_more", confidence: 0.65 }
              }
            ]
          }
        ]
      })) as typeof fetch;

    const result = await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture()
    });

    assert.equal(result?.signals.length, 1);
    assert.equal(result?.opportunities.length, 0);
    assert.deepEqual(result?.metadata.evaluation_roles, ["bull", "decision_agent"]);
    assert.equal(result?.metadata.evaluation_count, 2);
    assert.equal(result?.metadata.media_item_count, 2);
    assert.deepEqual(result?.metadata.media_sources, [
      { source: "github", count: 1 },
      { source: "reddit", count: 1 }
    ]);
    assert.deepEqual(result?.metadata.source_plan_routing, {
      source_plan: ["public founder communities", "Reddit r/SaaS posts", "GitHub issues"],
      query_hints: ["Reddit r/SaaS posts", "GitHub issues"],
      enabled_sources: ["reddit", "github"],
      reddit_subreddits: ["SaaS"],
      stack_exchange_sites: []
    });
    assert.equal(result?.metadata.opportunity_count, 1);
    assert.equal(result?.metadata.promoted_opportunity_count, 0);
    assert.deepEqual(result?.metadata.unpromoted_opportunities, [
      {
        title: "Idea validation coach",
        reason: "Needs at least two linked public-source signals before build approval.",
        recommendation: "research_more"
      }
    ]);
    assert.deepEqual(result?.metadata.evidence_summary, {
      opportunities: 1,
      build_ready_opportunities: 0,
      needs_more_evidence_opportunities: 1,
      reasons: ["Needs at least two linked public-source signals before build approval."]
    });
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research promotes only evidence-ready opportunities", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async () =>
      Response.json({
        status: "completed",
        evidence_summary: {
          opportunities: 1,
          build_ready_opportunities: 1,
          needs_more_evidence_opportunities: 0,
          reasons: []
        },
        signals: [
          {
            source: "reddit",
            title: "Pain one",
            body: "Founders struggle to choose credible ideas.",
            url: "https://example.com/pain-one"
          },
          {
            source: "stackoverflow",
            title: "Pain two",
            body: "Builders ask for concrete idea validation workflows.",
            url: "https://example.com/pain-two"
          }
        ],
        opportunities: [
          {
            title: "Idea validation coach",
            problem: "Founders struggle to choose credible ideas.",
            target_user: "solo founders",
            mvp_concept: "Conversational research brief compiler",
            score: 0.82,
            score_rationale: "Multiple public signals support the workflow pain.",
            source_indexes: [0, 1],
            profile: {
              evidence_sufficient_for_build: true,
              evidence_sufficiency_reason: "Two cited public-source signals are linked."
            },
            evaluations: [
              {
                evaluator: "decision_agent",
                content: "Prototype this.",
                scores: { recommendation: "prototype", confidence: 0.72 }
              }
            ]
          }
        ]
      })) as typeof fetch;

    const result = await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture()
    });

    assert.equal(result?.opportunities.length, 1);
    assert.equal(result?.metadata.opportunity_count, 1);
    assert.equal(result?.metadata.promoted_opportunity_count, 1);
    assert.equal(result?.metadata.unpromoted_opportunities, undefined);
    assert.equal(result?.opportunities[0].profile?.evidence_sufficient_for_build, true);
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research sends bearer auth when a shared secret is configured", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;
  let authorization: string | null = null;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json({ status: "completed", signals: [], opportunities: [] });
    }) as typeof fetch;

    await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture()
    });

    assert.equal(authorization, "Bearer research-secret");
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research forwards project owner and workspace scope", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  let userScope: string | null = null;
  let workspaceScope: string | null = null;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      userScope = headers.get("x-forge-user-id");
      workspaceScope = headers.get("x-forge-workspace-id");
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({
        status: "completed",
        request_scope: { owner_user_id: "user_1", workspace_id: "workspace_1" },
        signals: [],
        opportunities: []
      });
    }) as typeof fetch;

    const result = await runManagedBriefResearch({
      project: projectFixture({
        owner_user_id: "user_1",
        workspace_id: "workspace_1"
      }),
      researchBrief: briefFixture()
    });

    assert.ok(requestBody);
    const project = (requestBody as Record<string, unknown>).project as Record<string, unknown>;
    assert.equal(userScope, "user_1");
    assert.equal(workspaceScope, "workspace_1");
    assert.equal(project.owner_user_id, "user_1");
    assert.equal(project.workspace_id, "workspace_1");
    assert.deepEqual(result?.metadata.request_scope, {
      owner_user_id: "user_1",
      workspace_id: "workspace_1"
    });
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research forwards an explicit short-lived GitHub access token", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({ status: "completed", signals: [], opportunities: [] });
    }) as typeof fetch;

    await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture(),
      githubAccessToken: "github_app_installation_token"
    });

    assert.ok(requestBody);
    assert.equal(requestBody["github_access_token"], "github_app_installation_token");
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research omits GitHub access when source plan excludes GitHub collection", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({ status: "completed", signals: [], opportunities: [] });
    }) as typeof fetch;

    await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture({ source_plan: ["Reddit r/SaaS founder posts", "Stack Overflow questions"] }),
      githubAccessToken: "github_app_installation_token"
    });

    assert.ok(requestBody);
    assert.equal("github_access_token" in requestBody, false);
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research omits GitHub access when no connection token is available", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({ status: "completed", signals: [], opportunities: [] });
    }) as typeof fetch;

    await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture()
    });

    assert.ok(requestBody);
    assert.equal("github_access_token" in requestBody, false);
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research uses GitHub App connections for source-plan GitHub access", () => {
  const source = readFileSync(new URL("./research/managed-research-client.ts", import.meta.url), "utf8");
  const tokenBody = source.slice(
    source.indexOf("async function githubAccessPayload"),
    source.indexOf("function briefMayCollectGitHub")
  );

  assert.match(tokenBody, /candidate\.provider === "github_app"/);
  assert.match(tokenBody, /candidate\.installation_id/);
  assert.match(tokenBody, /installationTokenForConnection\(connection\)/);
  assert.doesNotMatch(tokenBody, /userAccessTokenForConnection/);
});

test("managed brief research does not call backend without auth configuration", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousAllow = process.env.FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH;
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    delete process.env.FORGE_MANAGED_RESEARCH_SECRET;
    delete process.env.FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ status: "completed", signals: [], opportunities: [] });
    }) as typeof fetch;

    const result = await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture()
    });

    assert.equal(result, null);
    assert.equal(fetchCalled, false);
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    restoreEnv("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", previousAllow);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research can call backend with explicit unauthenticated local mode", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousAllow = process.env.FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH;
  const previousFetch = globalThis.fetch;
  let authorization: string | null = null;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    delete process.env.FORGE_MANAGED_RESEARCH_SECRET;
    process.env.FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH = "1";
    globalThis.fetch = (async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json({ status: "completed", signals: [], opportunities: [] });
    }) as typeof fetch;

    const result = await runManagedBriefResearch({
      project: projectFixture(),
      researchBrief: briefFixture()
    });

    assert.ok(result);
    assert.equal(authorization, null);
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    restoreEnv("FORGE_ALLOW_UNAUTHENTICATED_MANAGED_RESEARCH", previousAllow);
    globalThis.fetch = previousFetch;
  }
});

test("managed brief research redacts tokens from backend error bodies", async () => {
  const previousUrl = process.env.FORGE_MANAGED_RESEARCH_URL;
  const previousSecret = process.env.FORGE_MANAGED_RESEARCH_SECRET;
  const previousFetch = globalThis.fetch;

  try {
    process.env.FORGE_MANAGED_RESEARCH_URL = "http://research.local";
    process.env.FORGE_MANAGED_RESEARCH_SECRET = "research-secret";
    globalThis.fetch = (async () =>
      new Response(
        "Authorization: Bearer research-secret github_access_token=github_app_installation_token access_token: other_token",
        { status: 500 }
      )) as typeof fetch;

    await assert.rejects(
      () =>
        runManagedBriefResearch({
          project: projectFixture(),
          researchBrief: briefFixture(),
          githubAccessToken: "github_app_installation_token"
        }),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /Managed research failed: 500/);
        assert.doesNotMatch(message, /research-secret/);
        assert.doesNotMatch(message, /github_app_installation_token/);
        assert.doesNotMatch(message, /other_token/);
        assert.match(message, /\[REDACTED\]/);
        return true;
      }
    );
  } finally {
    restoreEnv("FORGE_MANAGED_RESEARCH_URL", previousUrl);
    restoreEnv("FORGE_MANAGED_RESEARCH_SECRET", previousSecret);
    globalThis.fetch = previousFetch;
  }
});

function projectFixture(overrides: Partial<DbProject> = {}): DbProject {
  return {
    id: "project_1",
    name: "Idea Forge",
    mode: "new_product",
    ...overrides
  };
}

function briefFixture(overrides: Partial<DbResearchBrief> = {}): DbResearchBrief {
  return {
    id: "brief_1",
    project_id: "project_1",
    status: "approved",
    hypothesis: "Idea validation coach",
    target_users: ["solo founders"],
    pain_area: "Founders struggle to choose credible ideas.",
    constraints: [],
    source_plan: ["public founder communities"],
    disqualifying_evidence: [],
    mvp_boundaries: ["Conversational brief compiler"],
    user_taste_notes: [],
    open_questions: [],
    ...overrides
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
