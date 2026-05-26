export function opportunityStatusForPreferenceEvent(eventType: string): string | null {
  if (eventType === "approved") return "building";
  if (eventType === "rejected") return "rejected";
  if (eventType === "ignored") return "watching";
  if (eventType === "feedback") return "researching";
  return null;
}
