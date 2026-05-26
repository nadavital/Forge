import type { DbIdeaConversation } from "../db/types.ts";

export function ideaConversationCanContinue(
  conversation: Pick<DbIdeaConversation, "status"> | undefined | null
): boolean {
  return Boolean(conversation && conversation.status !== "closed");
}
