/**
 * Chat web search (server: /api/search). The slash command and icon only
 * appear when the companion's identity core has search_enabled and a provider
 * is configured server-side.
 */
export const SEARCH_COMMAND = /^\/(search|web)\s+(.+)$/is;

export function parseSearchCommand(text) {
  const m = String(text || "").trim().match(SEARCH_COMMAND);
  if (!m) return null;
  const query = m[2].replace(/\s+/g, " ").trim().slice(0, 200);
  return query ? query : null;
}

export function searchStatusMessage(out) {
  switch (out?.status) {
    case "ok":
      return null;
    case "empty":
      return "No safe results for that search.";
    case "rate_limited":
      return "You've used today's web searches. They reset tomorrow.";
    case "query_blocked":
      return "That search can't be run here.";
    case "disabled":
      return "Web search isn't on for this companion.";
    case "not_configured":
      return "Web search isn't set up on this server.";
    default:
      return "Search didn't go through. Try again in a moment.";
  }
}

/**
 * Runs `/search …` before the chat turn. Returns the message to send (the
 * query as the user's words + the audit id the server will rebuild context
 * from), or null when the search should not proceed.
 */
export async function prepareSearchTurn({ text, characterId, saveAsMemory = false, api, notify = () => {} }) {
  const query = parseSearchCommand(text);
  if (!query || !characterId || !api?.search?.run) return null;
  let out;
  try {
    out = await api.search.run({ characterId, query, saveAsMemory });
  } catch (err) {
    out = err?.payload || { status: "error" };
  }
  const msg = searchStatusMessage(out);
  if (msg) notify(msg);
  if (out?.status !== "ok" || !out.audit_id) return { text: query, webSearchAuditId: null, results: [] };
  return { text: query, webSearchAuditId: out.audit_id, results: out.results || [], remaining: out.remaining };
}
