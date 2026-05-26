import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pipelineSource = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
const ideaActionSource = readFileSync(new URL("../app/actions/idea.ts", import.meta.url), "utf8");
const ideaPanelSource = readFileSync(new URL("../components/ideas/IdeaIntakePanel.tsx", import.meta.url), "utf8");
const workerRouteSource = readFileSync(new URL("../app/api/pipeline/worker/route.ts", import.meta.url), "utf8");
const workerSmokeSource = readFileSync(new URL("../scripts/smoke-worker.ts", import.meta.url), "utf8");
const workerFlowSmokeSource = readFileSync(new URL("../scripts/smoke-worker-flow.ts", import.meta.url), "utf8");
const dashboardDataSource = readFileSync(new URL("./dashboard-data.ts", import.meta.url), "utf8");
const localDbSource = readFileSync(new URL("./db/local-db.ts", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("./db/repository.ts", import.meta.url), "utf8");
const vercelConfigSource = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");

test("research brief approval queues durable worker runs instead of doing managed research inline", () => {
  assert.match(pipelineSource, /export async function queueResearchBriefPipeline/);
  assert.match(pipelineSource, /"Synthesizer"/);
  assert.match(ideaActionSource, /queueResearchBriefPipeline\(input\.projectId, input\.briefId\)/);
  assert.doesNotMatch(ideaActionSource, /triggerProjectPipeline\(input\.projectId,\s*\{\s*researchBriefId/);
  assert.match(pipelineSource, /status: "queued"/);
  assert.match(pipelineSource, /queued_for: "pipeline_worker"/);
  assert.match(pipelineSource, /createBriefAgentTasks/);
});

test("queued research agent prompts preserve conversation-derived taste and constraints", () => {
  const agentPromptBody = pipelineSource.slice(
    pipelineSource.indexOf("function agentPromptForBrief"),
    pipelineSource.length
  );

  assert.match(agentPromptBody, /User and Forge constraints/);
  assert.match(agentPromptBody, /brief\.constraints/);
  assert.match(agentPromptBody, /User taste notes from the conversation/);
  assert.match(agentPromptBody, /brief\.user_taste_notes/);
  assert.match(agentPromptBody, /Known uncertainty/);
  assert.match(agentPromptBody, /brief\.open_questions/);
});

test("idea intake can manually run the visible queued research worker path", () => {
  assert.match(ideaActionSource, /export async function runQueuedResearch/);
  assert.match(ideaActionSource, /selectVisibleQueuedResearchRun\(bundle\.runs, input\.runId\)/);
  assert.match(
    ideaActionSource,
    /processQueuedPipelineRun\(\{[\s\S]*projectId: input\.projectId,[\s\S]*runId: run\.id[\s\S]*\}\)/
  );
  assert.match(ideaActionSource, /run\.research_brief_id && \(run\.status === "queued" \|\| run\.status === "running"\)/);
  assert.match(dashboardDataSource, /latestResearchRun/);
  assert.match(dashboardDataSource, /pipelineRunId: task\.pipeline_run_id/);
  assert.match(ideaPanelSource, /runQueuedResearch\(\{ projectId, runId: queuedResearchRunId \}\)/);
  assert.match(ideaPanelSource, /Run now/);
});

test("completed brief research exposes evidence sufficiency in the idea conversation", () => {
  assert.match(pipelineSource, /managed_research: managedDiscovery\?\.metadata/);
  assert.match(dashboardDataSource, /function mapResearchEvidenceSummary/);
  assert.match(dashboardDataSource, /managedResearch\?\.evidence_summary/);
  assert.match(dashboardDataSource, /source_plan_routing/);
  assert.match(dashboardDataSource, /media_sources/);
  assert.match(dashboardDataSource, /sourceAudit: researchSourceAudit\(managedResearch\)/);
  assert.match(dashboardDataSource, /build_ready_opportunities/);
  assert.match(dashboardDataSource, /needs_more_evidence_opportunities/);
  assert.match(dashboardDataSource, /evidenceSummary: mapResearchEvidenceSummary\(latestResearchRun\)/);
  assert.match(ideaPanelSource, /ResearchEvidenceStatus/);
});

test("pipeline worker endpoint requires bearer auth and processes explicit queued runs", () => {
  assert.match(pipelineSource, /export async function processQueuedPipelineRun/);
  assert.match(workerRouteSource, /FORGE_PIPELINE_WORKER_SECRET/);
  assert.match(workerRouteSource, /CRON_SECRET/);
  assert.match(workerRouteSource, /authorization/);
  assert.match(workerRouteSource, /timingSafeEqual/);
  assert.match(workerRouteSource, /constantTimeEqual\(token, secret\)/);
  assert.match(workerRouteSource, /processQueuedPipelineRun\(\{ projectId, runId \}\)/);
  assert.doesNotMatch(workerRouteSource, /service_role/i);
});

test("pipeline worker endpoint can sweep queued research runs for hosted cron", () => {
  assert.match(pipelineSource, /export async function processQueuedPipelineRuns/);
  assert.match(pipelineSource, /DEFAULT_WORKER_SWEEP_LIMIT/);
  assert.match(pipelineSource, /MAX_WORKER_SWEEP_LIMIT/);
  assert.match(pipelineSource, /loadQueuedResearchPipelineRunsForWorker\(\{/);
  assert.match(pipelineSource, /withActiveIdentity\(candidate\.identity/);
  assert.match(repositorySource, /export async function loadQueuedResearchPipelineRunsForWorker/);
  assert.match(repositorySource, /status=eq\.queued/);
  assert.match(repositorySource, /research_brief_id=not\.is\.null/);
  assert.match(repositorySource, /activeIdentityForProject\(project\)/);
  assert.match(workerRouteSource, /export async function GET\(request: Request\)/);
  assert.match(workerRouteSource, /processQueuedPipelineRuns\(\{ projectId, limit \}\)/);
  assert.match(workerRouteSource, /mode: "scheduled_sweep"/);
  assert.match(workerRouteSource, /processQueuedPipelineRuns\(\{ projectId: projectId \|\| undefined, limit \}\)/);
  assert.match(workerRouteSource, /body\.trim\(\) \? \(JSON\.parse\(body\) as WorkerRequest\) : \{\}/);
  assert.match(workerRouteSource, /payload\.probe === true/);
  assert.match(workerRouteSource, /mode: "probe"/);
  assert.match(workerRouteSource, /projectId is required when runId is provided/);
});

test("queued pipeline worker resolves project scope before processing runs", () => {
  assert.match(repositorySource, /const activeIdentityScope = new AsyncLocalStorage<ActiveIdentity>\(\)/);
  assert.match(repositorySource, /export function withActiveIdentity/);
  assert.match(repositorySource, /const scopedIdentity = activeIdentityScope\.getStore\(\)/);
  assert.match(repositorySource, /export async function getProjectWorkerIdentity/);
  assert.match(repositorySource, /select=id,owner_user_id,workspace_id/);
  assert.match(pipelineSource, /getProjectWorkerIdentity\(input\.projectId\)/);
  assert.match(pipelineSource, /processQueuedPipelineRunForActiveScope/);
});

test("vercel cron invokes the secured worker sweep path with a daily hobby-safe schedule", () => {
  const config = JSON.parse(vercelConfigSource) as { crons?: Array<{ path?: string; schedule?: string }> };
  assert.deepEqual(config.crons, [
    {
      path: "/api/pipeline/worker",
      schedule: "0 15 * * *"
    }
  ]);
});

test("worker probe smoke validates auth without processing queued runs or logging secrets", () => {
  assert.match(workerSmokeSource, /body: JSON\.stringify\(\{ probe: true \}\)/);
  assert.match(workerSmokeSource, /FORGE_PIPELINE_WORKER_SECRET/);
  assert.match(workerSmokeSource, /CRON_SECRET/);
  assert.match(workerSmokeSource, /Authorization: `Bearer \$\{secret\}`/);
  assert.match(workerSmokeSource, /redactSecrets\(body\.slice\(0, 240\), secret\)/);
  assert.doesNotMatch(workerSmokeSource, /console\.(log|error)\((workerSecret|secret)\)/);
  assert.doesNotMatch(workerSmokeSource, /JSON\.stringify\([^)]*(workerSecret|secret)/);
  assert.doesNotMatch(workerSmokeSource, /processQueuedPipelineRuns/);
  assert.doesNotMatch(workerSmokeSource, /processQueuedPipelineRun/);
});

test("worker flow smoke uses an isolated store and exercises queue to managed research output", () => {
  assert.match(localDbSource, /FORGE_LOCAL_STORE_DIR/);
  assert.match(workerFlowSmokeSource, /FORGE_LOCAL_STORE_DIR/);
  assert.match(workerFlowSmokeSource, /registerHooks/);
  assert.match(workerFlowSmokeSource, /mkdtemp/);
  assert.match(workerFlowSmokeSource, /queueResearchBriefPipeline/);
  assert.match(workerFlowSmokeSource, /processQueuedPipelineRuns\(\{ limit: 1 \}\)/);
  assert.match(workerFlowSmokeSource, /managed_research_brief/);
  assert.match(workerFlowSmokeSource, /evidence_sufficient_for_build: true/);
  assert.match(workerFlowSmokeSource, /build_ready_opportunities: 1/);
  assert.match(workerFlowSmokeSource, /bundle\.agentTasks\.filter\(\(task\) => task\.status === "completed"\)\.length/);
  assert.doesNotMatch(workerFlowSmokeSource, /\.forge-data/);
});

test("queued pipeline worker only supports research brief runs in the first slice", () => {
  assert.match(pipelineSource, /Queued worker currently supports research-brief runs only/);
  assert.match(pipelineSource, /updatePipelineRunStatus\(input\.projectId, run\.id/);
  assert.match(pipelineSource, /status: "running"/);
  assert.match(pipelineSource, /completePipelineRun\(input\.projectId, input\.run\.id/);
  assert.match(pipelineSource, /failPipelineRun\(input\.projectId, input\.run\.id/);
});

test("hosted connected repo discovery does not bypass the scoped GitHub connection", () => {
  assert.match(pipelineSource, /connectedRepoDiscoveryRequiresConnection\(\{ repoUrl, connection: githubConnection \}\)/);
  assert.match(pipelineSource, /Connect this repository with a GitHub App installation/);
  assert.match(pipelineSource, /Skipped public GitHub discovery because hosted mode requires a project-linked GitHub connection/);
  assert.match(pipelineSource, /missing: \["github_connection"\]/);
  assert.match(repositorySource, /connection_id/);
});

test("hosted research brief runs do not bypass the managed research backend", () => {
  assert.match(pipelineSource, /assertManagedBriefResearchReady\(\)/);
  assert.match(pipelineSource, /MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE/);
  assert.match(pipelineSource, /const managedDiscovery = await runManagedBriefResearch/);
  assert.match(pipelineSource, /managedDiscovery \?\? discoverNewProductIdeas/);
  assert.match(pipelineSource, /Skipped local brief-origin fallback because hosted mode requires source-backed managed research/);
  assert.match(pipelineSource, /missing: \["managed_research_backend"\]/);
});

test("new-product runs without an approved brief do not replace existing discovery records", () => {
  const noBriefBranch = pipelineSource.slice(
    pipelineSource.indexOf('source: "new_product_waiting_for_brief"'),
    pipelineSource.indexOf("export async function queueResearchBriefPipeline")
  );

  assert.match(pipelineSource, /source: "new_product_waiting_for_brief"/);
  assert.match(pipelineSource, /Skipped local context replacement so existing source-backed opportunities stay intact/);
  assert.match(pipelineSource, /approve a research brief before agents run/);
  assert.doesNotMatch(noBriefBranch, /replaceProjectDiscoveryRecords/);
  assert.doesNotMatch(noBriefBranch, /discoverNewProductIdeas\(\{/);
});

test("hosted research brief approval does not create a queued run when managed research is missing", () => {
  const queueFunction = pipelineSource.match(/export async function queueResearchBriefPipeline[\s\S]*?export async function processQueuedPipelineRun/)?.[0] ?? "";
  assert.match(queueFunction, /assertManagedBriefResearchReady\(\)/);
  assert.doesNotMatch(queueFunction, /updateResearchBriefStatus\([\s\S]*assertManagedBriefResearchReady\(\)/);
  assert.match(ideaActionSource, /MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE/);
  assert.match(ideaActionSource, /researchBriefCanRun\(brief\)/);
  assert.match(ideaActionSource, /Brief approved\. Configure FORGE_MANAGED_RESEARCH_URL and FORGE_MANAGED_RESEARCH_SECRET/);
  assert.match(ideaPanelSource, /brief\?\.status === "approved"/);
  assert.match(ideaPanelSource, /Start research/);
});
