import {
  addIdeaMessage,
  createIdeaConversation,
  saveResearchBrief
} from "@/lib/db/repository";
import type { DbIdeaMessage, DbResearchBrief, JsonObject } from "@/lib/db/types";
import {
  compilerFailureBrief,
  compilerPrompt,
  normalizeResearchBriefPayload,
  offlineCompilerBrief
} from "./idea-compiler-contract.ts";

const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const INTERACTIONS_API_REVISION = "2026-05-20";
const DEFAULT_AGENT = "gemini-2.5-pro";

export type IdeaConversationAdvance = {
  conversationId: string;
  assistantMessage: string;
  brief?: DbResearchBrief;
};

export async function startIdeaConversation(input: {
  projectId: string;
  message: string;
}): Promise<IdeaConversationAdvance> {
  const { conversation } = await createIdeaConversation(input.projectId, input.message);
  return continueIdeaConversation({
    projectId: input.projectId,
    conversationId: conversation.id,
    messages: [
      {
        id: "initial",
        conversation_id: conversation.id,
        role: "user",
        content: input.message,
        created_at: new Date().toISOString()
      }
    ],
    alreadyStoredUserMessage: true
  });
}

export async function continueIdeaConversation(input: {
  projectId: string;
  conversationId: string;
  message?: string;
  messages: DbIdeaMessage[];
  alreadyStoredUserMessage?: boolean;
}): Promise<IdeaConversationAdvance> {
  const messages = [...input.messages];
  const userMessage = input.message?.trim();
  if (userMessage && !input.alreadyStoredUserMessage) {
    const stored = await addIdeaMessage({
      projectId: input.projectId,
      conversationId: input.conversationId,
      role: "user",
      content: userMessage
    });
    messages.push(stored);
  }

  const compiled = await compileResearchBrief({
    projectId: input.projectId,
    conversationId: input.conversationId,
    messages
  });

  const assistant = await addIdeaMessage({
    projectId: input.projectId,
    conversationId: input.conversationId,
    role: "assistant",
    content: compiled.assistantMessage,
    metadata: {
      brief_status: compiled.brief.status,
      confidence: compiled.brief.confidence
    }
  });
  const brief = await saveResearchBrief(compiled.brief);

  return {
    conversationId: input.conversationId,
    assistantMessage: assistant.content,
    brief
  };
}

async function compileResearchBrief(input: {
  projectId: string;
  conversationId: string;
  messages: DbIdeaMessage[];
}): Promise<{
  assistantMessage: string;
  brief: Omit<DbResearchBrief, "id" | "created_at" | "updated_at">;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return offlineBrief(input);
  }

  let payload: JsonObject;
  try {
    const raw = await createInteraction({
      apiKey,
      prompt: compilerPrompt(input.messages),
      timeoutMs: Number(process.env.FORGE_IDEA_COMPILER_TIMEOUT_MS || 120000)
    });
    payload = extractJsonObject(raw);
  } catch (error) {
    return compilerFailureBrief({ ...input, error });
  }

  const brief = normalizeResearchBriefPayload({
    projectId: input.projectId,
    conversationId: input.conversationId,
    payload
  });
  const claimedReady = payloadClaimsReady(payload);
  const assistantMessage =
    claimedReady && brief.status !== "ready_for_research"
      ? `I need one more pass before research: ${brief.open_questions.slice(0, 2).join(" ")}`
      : cleanString(payload.assistant_message) ||
        "I have enough context to turn this into a research brief.";

  return {
    assistantMessage,
    brief
  };
}

async function createInteraction(input: {
  apiKey: string;
  prompt: string;
  timeoutMs: number;
}): Promise<string> {
  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Api-Revision": INTERACTIONS_API_REVISION,
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey
    },
    signal: AbortSignal.timeout(input.timeoutMs),
    body: JSON.stringify({
      agent: process.env.FORGE_IDEA_COMPILER_AGENT || DEFAULT_AGENT,
      input: input.prompt,
      system_instruction:
        "You are Forge's product-intake agent. Have a natural conversation, compile a research brief, and return strict JSON only."
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Idea compiler failed: ${response.status} ${text.slice(0, 600)}`);
  }
  return interactionText(text);
}

function offlineBrief(input: {
  projectId: string;
  conversationId: string;
  messages: DbIdeaMessage[];
}): {
  assistantMessage: string;
  brief: Omit<DbResearchBrief, "id" | "created_at" | "updated_at">;
} {
  return offlineCompilerBrief(input);
}

function payloadClaimsReady(payload: JsonObject): boolean {
  const brief = objectValue(payload.brief) ?? payload;
  return cleanString(brief.status) === "ready_for_research";
}

function interactionText(raw: string): string {
  const payload = extractJsonObject(raw);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = objectValue(candidates[0]);
  const content = objectValue(first?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .map((part) => objectValue(part)?.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();
  return text || raw;
}

function extractJsonObject(raw: string): JsonObject {
  const trimmed = raw.trim();
  const direct = tryParseObject(trimmed);
  if (direct) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseObject(fenced[1].trim());
    if (parsed) return parsed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = tryParseObject(trimmed.slice(start, end + 1));
    if (parsed) return parsed;
  }
  throw new Error("Managed idea compiler did not return a JSON object.");
}

function tryParseObject(value: string): JsonObject | null {
  try {
    const parsed = JSON.parse(value);
    return objectValue(parsed);
  } catch {
    return null;
  }
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
