#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const localPath = specifier.endsWith(".ts") ? specifier.slice(2) : `${specifier.slice(2)}.ts`;
      return nextResolve(new URL(`../${localPath}`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const storeDir = await mkdtemp(path.join(tmpdir(), "forge-worker-flow-"));
const managedResearch = await startManagedResearchFixture();

process.env.FORGE_LOCAL_STORE_DIR = storeDir;
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.FORGE_USER_ID = "smoke_user";
process.env.FORGE_WORKSPACE_ID = "smoke_workspace";
process.env.FORGE_AUTH_SUBJECT = "smoke_auth_subject";
process.env.FORGE_MANAGED_RESEARCH_URL = managedResearch.url;
process.env.FORGE_MANAGED_RESEARCH_SECRET = "smoke-managed-research-secret";
process.env.FORGE_MANAGED_RESEARCH_TIMEOUT_MS = "5000";

try {
  const [{ createProjectRecord, createIdeaConversation, getProjectBundle, saveResearchBrief }, pipeline] =
    await Promise.all([
      import("../lib/db/repository.ts"),
      import("../lib/pipeline.ts")
    ]);

  const project = await createProjectRecord({
    name: "Worker flow smoke",
    mode: "new_product",
    description: "Verify AI brief queue processing through the local worker.",
    markets: ["developer tools"],
    riskTolerance: "medium"
  });
  const { conversation } = await createIdeaConversation(
    project.id,
    "Build a product that helps solo iOS developers make App Store screenshots faster."
  );
  const brief = await saveResearchBrief({
    project_id: project.id,
    conversation_id: conversation.id,
    status: "approved",
    hypothesis: "Solo iOS developers need a faster App Store screenshot planning workflow.",
    target_users: ["Solo iOS developers"],
    pain_area: "App Store screenshot production requires repetitive manual planning and resizing.",
    constraints: ["Free services only", "Generated MVP must stay local-first"],
    source_plan: ["Search developer communities for screenshot workflow pain"],
    disqualifying_evidence: ["Existing free tools already solve planning, capture, and export end to end"],
    mvp_boundaries: ["Research-backed screenshot checklist and lightweight planner"],
    user_taste_notes: ["Narrow, practical, no marketing shell"],
    open_questions: ["Which screenshot step burns the most time?"],
    confidence: 0.68
  });

  const queued = await pipeline.queueResearchBriefPipeline(project.id, brief.id);
  assertEqual(queued.taskCount, 7, "expected queueing to create seven agent tasks");

  const processed = await pipeline.processQueuedPipelineRuns({ limit: 1 });
  assertEqual(processed.status, "completed", "expected queued run sweep to complete");
  assertEqual(processed.processed, 1, "expected exactly one queued run to be processed");

  const bundle = await getProjectBundle(project.id);
  const run = bundle.runs.find((row) => row.id === queued.runId);
  const completedBrief = bundle.researchBriefs.find((row) => row.id === brief.id);
  assertEqual(run?.status, "completed", "expected pipeline run to complete");
  assertEqual(completedBrief?.status, "completed", "expected research brief to complete");
  assertEqual(bundle.signals.length, 2, "expected managed research fixture signals to be stored");
  assertEqual(bundle.opportunities.length, 1, "expected managed research fixture opportunity to be stored");
  assertEqual(
    String(bundle.opportunities[0]?.profile?.origin),
    "managed_research_brief",
    "expected opportunity to preserve managed research origin"
  );
  assertEqual(
    bundle.agentTasks.filter((task) => task.status === "completed").length,
    7,
    "expected all agent tasks to complete from role-shaped managed research output"
  );

  console.log(
    `[ok] Worker flow smoke processed ${processed.processed} queued brief run, stored ${bundle.signals.length} signals and ${bundle.opportunities.length} opportunity.`
  );
} finally {
  await managedResearch.close();
  await rm(storeDir, { recursive: true, force: true });
}

function startManagedResearchFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/api/research-briefs/run") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (request.headers.authorization !== "Bearer smoke-managed-research-secret") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as { research_brief?: { hypothesis?: string } };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(managedResearchPayload(payload.research_brief?.hypothesis)));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Managed research fixture did not bind to a TCP port."));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}

function managedResearchPayload(hypothesis = "Screenshot workflow pain") {
  return {
    status: "completed",
    query: hypothesis,
    summary: "Fixture research found repeated screenshot workflow friction.",
    media_items: [],
    evidence_summary: {
      opportunities: 1,
      build_ready_opportunities: 1,
      needs_more_evidence_opportunities: 0,
      reasons: []
    },
    signals: [
      {
        source: "reddit",
        title: "Developers complain about screenshot workflow repetition",
        body: "Solo app developers repeatedly describe screenshot planning and export as tedious.",
        url: "https://example.test/reddit/screenshot-workflow"
      },
      {
        source: "github",
        title: "Open-source screenshot tools still require manual planning",
        body: "Existing tools help capture frames but leave copy and size planning to the developer.",
        url: "https://example.test/github/screenshot-tools"
      }
    ],
    opportunities: [
      {
        title: "Screenshot launch planner",
        problem: "Solo iOS developers waste launch time planning screenshot sets across device sizes.",
        target_user: "Solo iOS developers",
        mvp_concept: "A local-first planner that turns app positioning into a screenshot checklist and export plan.",
        score: 0.74,
        score_rationale: "Specific pain, narrow MVP, and free-service implementation path.",
        source_indexes: [0, 1],
        profile: {
          evidence_sufficient_for_build: true,
          evidence_sufficiency_reason: "Two cited public-source signals are linked."
        },
        evaluations: [
          {
            evaluator: "bull",
            content: "The pain is frequent and fits a small productized workflow.",
            scores: { confidence: 0.76 }
          },
          {
            evaluator: "bear",
            content: "Some developers may keep using design templates instead of a planner.",
            scores: { risk: 0.38 }
          },
          {
            evaluator: "taste_critic",
            content: "Keep the MVP utilitarian and avoid generic launch-marketing features.",
            scores: { taste_fit: 0.82 }
          },
          {
            evaluator: "decision_agent",
            content: "Prototype the planner after one more source pass.",
            scores: { recommendation: "prototype", confidence: 0.7 }
          },
          {
            evaluator: "synthesizer_agent",
            content: "Build a local-first screenshot launch planner with checklist, copy notes, and export-plan metadata.",
            scores: { build_fit: 0.74 }
          }
        ]
      }
    ]
  };
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}
