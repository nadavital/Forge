import type { DbIdeaMessage, DbResearchBrief, JsonObject } from "../db/types.ts";

export function compilerPrompt(messages: DbIdeaMessage[]): string {
  return `Use this conversation to either ask the next natural product question or produce a research-ready brief.

Do not use a fixed questionnaire. Ask only the one or two highest-leverage questions if the brief is not ready.
Prefer uncertainty and disqualifying evidence over enthusiasm.

Conversation:
${messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n")}

Return strict JSON:
{
  "assistant_message": "natural response to the user",
  "brief": {
    "status": "needs_context" | "ready_for_research",
    "hypothesis": "testable product hypothesis",
    "target_users": ["specific users"],
    "pain_area": "specific pain area",
    "constraints": ["user constraints and Forge constraints"],
    "source_plan": ["sources or searches agents should run"],
    "disqualifying_evidence": ["evidence that should make Forge stop or recommend not building"],
    "mvp_boundaries": ["what a v1 MVP may and may not do"],
    "user_taste_notes": ["taste and preference signals from the conversation"],
    "open_questions": ["remaining unknowns"],
    "confidence": 0.0
  }
}`;
}

export function compilerFailureBrief(input: {
  projectId: string;
  conversationId: string;
  messages: DbIdeaMessage[];
  error: unknown;
}): {
  assistantMessage: string;
  brief: Omit<DbResearchBrief, "id" | "created_at" | "updated_at">;
} {
  const latestUserText = [...input.messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();
  const message = input.error instanceof Error ? input.error.message : String(input.error || "Unknown compiler error");

  return {
    assistantMessage:
      "I saved that direction, but the AI intake could not compile a research-ready brief yet. Keep shaping the idea with one more concrete detail, then retry after the compiler is healthy.",
    brief: draftNeedsContextBrief({
      projectId: input.projectId,
      conversationId: input.conversationId,
      messages: input.messages,
      fallbackHypothesis: latestUserText || "Uncompiled product direction",
      reason: `Idea compiler error: ${truncate(message, 180)}`
    })
  };
}

export function offlineCompilerBrief(input: {
  projectId: string;
  conversationId: string;
  messages: DbIdeaMessage[];
}): {
  assistantMessage: string;
  brief: Omit<DbResearchBrief, "id" | "created_at" | "updated_at">;
} {
  return {
    assistantMessage:
      "I saved that direction. The idea compiler is not configured yet, so I can keep the draft moving but will not mark it ready for research.",
    brief: draftNeedsContextBrief({
      projectId: input.projectId,
      conversationId: input.conversationId,
      messages: input.messages,
      fallbackHypothesis: "Unconfigured product direction",
      reason: "AI intake is not configured yet."
    })
  };
}

export function normalizeResearchBriefPayload(input: {
  projectId: string;
  conversationId: string;
  payload: JsonObject;
}): Omit<DbResearchBrief, "id" | "created_at" | "updated_at"> {
  const brief = objectValue(input.payload.brief) ?? input.payload;
  const rawHypothesis = cleanString(brief.hypothesis);
  const targetUsers = stringArray(brief.target_users).slice(0, 6);
  const painArea = cleanString(brief.pain_area);
  const sourcePlan = stringArray(brief.source_plan).slice(0, 8);
  const disqualifyingEvidence = stringArray(brief.disqualifying_evidence).slice(0, 8);
  const mvpBoundaries = stringArray(brief.mvp_boundaries).slice(0, 8);
  const openQuestions = stringArray(brief.open_questions).slice(0, 8);
  const readinessIssues = missingReadinessIssues({
    hypothesis: rawHypothesis,
    targetUsers,
    painArea,
    sourcePlan,
    disqualifyingEvidence,
    mvpBoundaries
  });
  const status =
    cleanString(brief.status) === "ready_for_research" && readinessIssues.length === 0
      ? "ready_for_research"
      : "needs_context";
  const generatedOpenQuestions =
    openQuestions.length > 0
      ? []
      : conversationDerivedFollowUps({
          hypothesis: rawHypothesis,
          targetUsers,
          painArea,
          readinessIssues
        });

  return {
    project_id: input.projectId,
    conversation_id: input.conversationId,
    status,
    hypothesis: rawHypothesis || "Unspecified product hypothesis",
    target_users: targetUsers,
    pain_area: painArea,
    constraints: stringArray(brief.constraints).slice(0, 8),
    source_plan: sourcePlan,
    disqualifying_evidence: disqualifyingEvidence,
    mvp_boundaries: mvpBoundaries,
    user_taste_notes: stringArray(brief.user_taste_notes).slice(0, 8),
    open_questions: uniqueStrings([...openQuestions, ...generatedOpenQuestions]).slice(0, 8),
    confidence: normalizeConfidence(brief.confidence)
  };
}

type ReadinessIssue = "hypothesis" | "target_users" | "pain_area" | "source_plan" | "disqualifying_evidence" | "mvp_boundaries";

function missingReadinessIssues(input: {
  hypothesis: string;
  targetUsers: string[];
  painArea: string;
  sourcePlan: string[];
  disqualifyingEvidence: string[];
  mvpBoundaries: string[];
}): ReadinessIssue[] {
  const missing: ReadinessIssue[] = [];
  if (!input.hypothesis) missing.push("hypothesis");
  if (input.targetUsers.length === 0) missing.push("target_users");
  if (!input.painArea) missing.push("pain_area");
  if (input.sourcePlan.length === 0) missing.push("source_plan");
  if (input.disqualifyingEvidence.length === 0) missing.push("disqualifying_evidence");
  if (input.mvpBoundaries.length === 0) missing.push("mvp_boundaries");
  return missing;
}

function conversationDerivedFollowUps(input: {
  hypothesis: string;
  targetUsers: string[];
  painArea: string;
  readinessIssues: ReadinessIssue[];
}): string[] {
  const subject = quoteFragment(input.hypothesis) || "this direction";
  const user = input.targetUsers[0] || "the first user";
  const followUps: string[] = [];

  if (input.readinessIssues.includes("hypothesis")) {
    followUps.push("What product bet should Forge research from this conversation?");
  }
  if (input.readinessIssues.includes("target_users")) {
    followUps.push(`Who specifically feels the pain behind ${subject}?`);
  }
  if (input.readinessIssues.includes("pain_area")) {
    followUps.push(`What concrete painful moment should Forge validate for ${user}?`);
  }
  if (input.readinessIssues.includes("source_plan")) {
    followUps.push(`Where have you seen ${user} already talk about this problem?`);
  }
  if (input.readinessIssues.includes("disqualifying_evidence")) {
    followUps.push(`What evidence would make you drop ${subject}?`);
  }
  if (input.readinessIssues.includes("mvp_boundaries")) {
    followUps.push(`What is the smallest useful version of ${subject}?`);
  }
  return followUps.slice(0, 2);
}

function draftNeedsContextBrief(input: {
  projectId: string;
  conversationId: string;
  messages: DbIdeaMessage[];
  fallbackHypothesis: string;
  reason: string;
}): Omit<DbResearchBrief, "id" | "created_at" | "updated_at"> {
  const userText = input.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .trim();
  const hypothesis = truncate(userText || input.fallbackHypothesis, 300);
  const openQuestions = conversationDerivedFollowUps({
    hypothesis,
    targetUsers: [],
    painArea: "",
    readinessIssues: ["target_users", "pain_area", "source_plan", "disqualifying_evidence", "mvp_boundaries"]
  });

  return {
    project_id: input.projectId,
    conversation_id: input.conversationId,
    status: "needs_context",
    hypothesis,
    target_users: [],
    pain_area: "",
    constraints: [
      "No paid APIs, production deployments, or secret-requiring integrations in generated MVPs",
      input.reason
    ],
    source_plan: [],
    disqualifying_evidence: [],
    mvp_boundaries: [],
    user_taste_notes: [],
    open_questions: openQuestions,
    confidence: 0
  };
}

function quoteFragment(value: string): string {
  const cleaned = truncate(value, 80);
  return cleaned ? `"${cleaned}"` : "";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanString(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return 0.4;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3).trim()}...` : value;
}
