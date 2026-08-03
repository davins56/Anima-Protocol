/**
 * When a chat turn fails after tokens have already painted, keep the partial
 * assistant reply instead of wiping it. Only remove empty placeholders
 * (__thinking__ / __typing__ / empty streaming bubbles).
 *
 * @param {Array<object>} messages
 * @returns {{ messages: Array<object>, retained: object | null }}
 */
export function retainStreamingOnError(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let retained = null;

  const next = [];
  for (const m of list) {
    if (m?.character_name === "__typing__" || m?.character_name === "__thinking__") {
      continue;
    }
    if (m?.is_streaming) {
      const text = String(m.content || "").trim();
      if (!text || text === "...") {
        continue;
      }
      retained = {
        ...m,
        content: text,
        is_streaming: false,
      };
      next.push(retained);
      continue;
    }
    next.push(m);
  }

  return { messages: next, retained };
}
