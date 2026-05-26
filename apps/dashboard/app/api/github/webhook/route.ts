import { NextResponse } from "next/server";
import { updateGitHubConnectionsByInstallation } from "@/lib/db/repository";
import {
  githubInstallationStatusForWebhook,
  verifyGitHubWebhookSignature
} from "@/lib/github/github-app";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, message: "GITHUB_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  const valid = verifyGitHubWebhookSignature({
    body,
    signatureHeader: request.headers.get("x-hub-signature-256"),
    secret
  });
  if (!valid) {
    return NextResponse.json({ ok: false, message: "Invalid GitHub webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }

  const update = githubInstallationStatusForWebhook(request.headers.get("x-github-event"), payload);
  if (!update) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 202 });
  }

  const updatedConnections = await updateGitHubConnectionsByInstallation(update);
  return NextResponse.json({
    ok: true,
    installationId: update.installationId,
    status: update.status,
    updatedConnections
  });
}
