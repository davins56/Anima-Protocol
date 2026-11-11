/**
 * Rows that are still being painted: the typing dots, the thinking line, and
 * the bubble a reply is streaming into. They change on every token.
 * @param {any} m
 */
export function isTransientMessage(m) {
  return (
    !m ||
    m.is_streaming === true ||
    m.character_name === "__typing__" ||
    m.character_name === "__thinking__"
  );
}

/**
 * The thread without in-flight rows, reusing `previous` when nothing settled
 * changed, so widgets that read the thread keep a stable array while a reply
 * streams in and only see it once it lands.
 *
 * @param {any[] | null | undefined} messages
 * @param {any[] | null | undefined} previous
 * @returns {any[]}
 */
export function settleMessages(messages, previous) {
  const next = (Array.isArray(messages) ? messages : []).filter((m) => !isTransientMessage(m));
  if (
    Array.isArray(previous) &&
    previous.length === next.length &&
    next.every((m, i) => m === previous[i])
  ) {
    return previous;
  }
  return next;
}
