/**
 * User-visible copy for `/api/chat/messages` SSE `status` events.
 * Comment keepalives are dropped by the client parser — only JSON status
 * reaches the Chat bubble.
 *
 * @param {{ status?: string, phase?: string, minds?: unknown, queue_position?: unknown }} event
 * @returns {string | null}
 */
export function chatStreamStatusCopy(event) {
  if (!event?.status) return null;
  if (event.status === "waiting") {
    const ahead = Number(event.queue_position);
    if (Number.isFinite(ahead) && ahead > 1) {
      return `Still here — ${Math.floor(ahead)} ahead.`;
    }
    return "Still here — one reply ahead.";
  }
  if (event.status === "thinking") return "thinking...";
  if (event.status === "ensemble") {
    const minds = Array.isArray(event.minds)
      ? event.minds.filter(Boolean).join(", ")
      : "";
    if (event.phase === "combining") return "Combining mind drafts…";
    return minds ? `Minds drafting: ${minds}…` : "Minds drafting…";
  }
  if (event.status === "progress") {
    if (event.phase === "preparing") return "Gathering your companion…";
    if (event.phase === "waking") return "Waiting on the local Anima model…";
    if (event.phase === "generating") return "Composing a reply…";
    return "Waiting on the local Anima model…";
  }
  return null;
}
