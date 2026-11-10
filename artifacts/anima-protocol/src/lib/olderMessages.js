/** Messages fetched per "Previous messages" tap once the opened page runs out. */
export const OLDER_MESSAGES_PAGE = 50;

/**
 * Oldest numeric `seq` in the loaded thread, or null when rows carry none
 * (a just-created or locally-built thread).
 * @param {any[] | null | undefined} messages
 */
export function oldestSeq(messages) {
  let min = null;
  for (const m of Array.isArray(messages) ? messages : []) {
    const seq = typeof m?.seq === "number" ? m.seq : typeof m?.seq === "string" && m.seq !== "" ? Number(m.seq) : NaN;
    if (Number.isFinite(seq) && (min === null || seq < min)) min = seq;
  }
  return min;
}

/**
 * Whether the server may still hold rows older than the loaded ones.
 * seq starts at 0, so a thread whose oldest loaded row is seq 0 is complete.
 * @param {any[] | null | undefined} messages
 */
export function mayHaveOlderMessages(messages) {
  const seq = oldestSeq(messages);
  return seq !== null && seq > 0;
}

/**
 * Prepend an older page, skipping rows already in the thread (by id).
 * @param {any[] | null | undefined} current
 * @param {any[] | null | undefined} older
 */
export function mergeOlderMessages(current, older) {
  const rows = Array.isArray(current) ? current : [];
  const ids = new Set(rows.map((m) => m?.id).filter(Boolean));
  const fresh = (Array.isArray(older) ? older : []).filter((m) => m && !(m.id && ids.has(m.id)));
  if (fresh.length === 0) return rows;
  return [...fresh, ...rows];
}
