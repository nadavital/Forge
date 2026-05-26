import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { processQueuedPipelineRun, processQueuedPipelineRuns } from "@/lib/pipeline";

type WorkerRequest = {
  projectId?: unknown;
  runId?: unknown;
  limit?: unknown;
  probe?: unknown;
};

export async function GET(request: Request) {
  const authError = authorizeWorker(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId")?.trim() || undefined;
  const limit = parseLimit(searchParams.get("limit"));

  try {
    const result = await processQueuedPipelineRuns({ projectId, limit });
    return NextResponse.json({
      mode: "scheduled_sweep",
      ...result
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const authError = authorizeWorker(request);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  let payload: WorkerRequest;
  try {
    const body = await request.text();
    payload = body.trim() ? (JSON.parse(body) as WorkerRequest) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  const limit = parseLimit(payload.limit);
  if (payload.probe === true) {
    return NextResponse.json({
      ok: true,
      mode: "probe",
      sweepSupported: true,
      explicitRunSupported: true
    });
  }
  if (runId && !projectId) {
    return NextResponse.json({ error: "projectId is required when runId is provided." }, { status: 400 });
  }

  try {
    const result = runId
      ? await processQueuedPipelineRun({ projectId, runId })
      : await processQueuedPipelineRuns({ projectId: projectId || undefined, limit });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return Number(value);
  }
  return undefined;
}

function authorizeWorker(request: Request): string | null {
  const secret = process.env.FORGE_PIPELINE_WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) {
    return "FORGE_PIPELINE_WORKER_SECRET or CRON_SECRET is required.";
  }
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return constantTimeEqual(token, secret) ? null : "Pipeline worker authorization required.";
}

function constantTimeEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
