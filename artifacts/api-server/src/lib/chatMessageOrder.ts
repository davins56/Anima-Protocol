/**
 * Sequence placement for a chat turn's store rows.
 *
 * A late reply must sit immediately after its own user message. Appending at
 * max(seq)+1 puts that answer after newer committed turns, so the next prompt
 * reads question, stale answer, question again.
 */

export type SeqRow = {
  id: string;
  seq: number;
  at: number;
};

export type TurnSeqPlan = {
  /** Null when the user row already exists or this turn has no user line. */
  userSeq: number | null;
  assistantSeq: number;
  /** True when an existing assistant row is not directly under its user line. */
  reseatAssistant: boolean;
};

function finiteSeq(value: number): number {
  return Number.isFinite(value) ? value : -1;
}

/** Smallest seq strictly after `anchor`, or the next integer after the max. */
export function seqImmediatelyAfter(rows: SeqRow[], anchorSeq: number): number {
  let next = Number.POSITIVE_INFINITY;
  let max = anchorSeq;
  for (const row of rows) {
    const seq = finiteSeq(row.seq);
    if (seq > max) max = seq;
    if (seq > anchorSeq && seq < next) next = seq;
  }
  if (!Number.isFinite(next)) return Math.floor(max) + 1;
  return (anchorSeq + next) / 2;
}

/** Seq that sorts this turn before the first strictly newer row. */
export function seqForCreatedAt(rows: SeqRow[], createdAtMs: number): number {
  const sorted = [...rows].sort((a, b) => finiteSeq(a.seq) - finiteSeq(b.seq));
  const newer = sorted.find((row) => row.at > createdAtMs);
  if (!newer) {
    const max = sorted.reduce((highest, row) => Math.max(highest, finiteSeq(row.seq)), -1);
    return max + 1;
  }
  const newerSeq = finiteSeq(newer.seq);
  const prev = [...sorted].reverse().find((row) => finiteSeq(row.seq) < newerSeq);
  const floor = prev ? finiteSeq(prev.seq) : newerSeq - 1;
  return (floor + newerSeq) / 2;
}

function withoutId(rows: SeqRow[], id: string): SeqRow[] {
  return rows.filter((row) => row.id !== id);
}

/**
 * True when something sits between the user line and the assistant line, or
 * the assistant line sorts before its user line.
 */
export function assistantIsAfterOwnUser(
  rows: SeqRow[],
  userMessageId: string,
  assistantMessageId: string,
): boolean {
  const user = rows.find((row) => row.id === userMessageId);
  const assistant = rows.find((row) => row.id === assistantMessageId);
  if (!user || !assistant) return false;
  if (assistant.seq < user.seq) return false;
  return !rows.some(
    (row) =>
      row.id !== assistantMessageId &&
      row.seq > user.seq &&
      row.seq < assistant.seq,
  );
}

export function planTurnMessageSeqs(
  rows: SeqRow[],
  turn: {
    userMessageId: string;
    assistantMessageId: string;
    createdAtMs: number;
    includeUser: boolean;
  },
): TurnSeqPlan {
  const user = rows.find((row) => row.id === turn.userMessageId);
  const assistant = rows.find((row) => row.id === turn.assistantMessageId);
  const seated =
    Boolean(assistant) &&
    assistantIsAfterOwnUser(rows, turn.userMessageId, turn.assistantMessageId);

  if (assistant && seated) {
    return { userSeq: null, assistantSeq: assistant.seq, reseatAssistant: false };
  }

  const pool = assistant ? withoutId(rows, turn.assistantMessageId) : rows;
  const anchor = pool.find((row) => row.id === turn.userMessageId);

  if (anchor) {
    return {
      userSeq: null,
      assistantSeq: seqImmediatelyAfter(pool, anchor.seq),
      reseatAssistant: Boolean(assistant),
    };
  }

  if (!turn.includeUser) {
    return {
      userSeq: null,
      assistantSeq: seqForCreatedAt(pool, turn.createdAtMs),
      reseatAssistant: Boolean(assistant),
    };
  }

  const userSeq = seqForCreatedAt(pool, turn.createdAtMs);
  const withUser: SeqRow[] = [
    ...pool,
    { id: turn.userMessageId, seq: userSeq, at: turn.createdAtMs },
  ];
  return {
    userSeq,
    assistantSeq: seqImmediatelyAfter(withUser, userSeq),
    reseatAssistant: Boolean(assistant),
  };
}
