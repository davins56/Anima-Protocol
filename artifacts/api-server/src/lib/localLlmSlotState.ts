/**
 * Single-slot book for the local Ollama host.
 * One holder, FIFO chat queue, TTL so a dead holder cannot wedge the host.
 * The Durable Object and the in-process coordinator both apply these
 * functions. Mutations are synchronous so two callers cannot both pass.
 */

export type SlotKind = "chat" | "background";

export type SlotHolder = {
  id: string;
  kind: SlotKind;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

export type SlotQueueEntry = {
  id: string;
  enqueuedAt: number;
  touchedAt: number;
};

export type SlotBook = {
  holder: SlotHolder | null;
  queue: SlotQueueEntry[];
};

export type SlotStep = {
  granted: boolean;
  position: number;
};

export function emptySlotBook(): SlotBook {
  return { holder: null, queue: [] };
}

function expire(book: SlotBook, now: number, queueTtlMs: number): void {
  if (book.holder && book.holder.expiresAt <= now) {
    book.holder = null;
  }
  if (queueTtlMs > 0) {
    book.queue = book.queue.filter((entry) => now - entry.touchedAt < queueTtlMs);
  }
}

function hold(
  id: string,
  kind: SlotKind,
  now: number,
  ttlMs: number,
): SlotHolder {
  return {
    id,
    kind,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: now + ttlMs,
  };
}

/**
 * Chat turns take the slot in arrival order.
 * `position` is how many turns are ahead (1 = the holder, or the only
 * waiter when the slot is free and this turn is not yet head).
 */
export function applyChatStep(
  book: SlotBook,
  turnId: string,
  now: number,
  ttlMs: number,
  queueTtlMs: number,
): SlotStep {
  const id = String(turnId || "").trim();
  expire(book, now, queueTtlMs);
  if (!id) return { granted: false, position: 0 };
  if (book.holder?.id === id && book.holder.kind === "chat") {
    book.holder.heartbeatAt = now;
    book.holder.expiresAt = now + ttlMs;
    return { granted: true, position: 0 };
  }
  const mine = book.queue.findIndex((entry) => entry.id === id);
  const head = book.queue[0]?.id;
  const canTake = !book.holder && (book.queue.length === 0 || head === id);
  if (canTake) {
    if (mine >= 0) book.queue.splice(mine, 1);
    book.holder = hold(id, "chat", now, ttlMs);
    return { granted: true, position: 0 };
  }
  if (mine >= 0) {
    book.queue[mine]!.touchedAt = now;
  } else {
    book.queue.push({ id, enqueuedAt: now, touchedAt: now });
  }
  const position = book.queue.findIndex((entry) => entry.id === id) + 1;
  return { granted: false, position };
}

/**
 * Background work (proactive, journal, sidecars, warm) never waits.
 * Skip when the slot is held or any chat turn is already in line.
 */
export function applyTryBackground(
  book: SlotBook,
  id: string,
  now: number,
  ttlMs: number,
  queueTtlMs: number,
): boolean {
  const caller = String(id || "").trim();
  expire(book, now, queueTtlMs);
  if (!caller) return false;
  if (book.holder?.id === caller) {
    book.holder.heartbeatAt = now;
    book.holder.expiresAt = now + ttlMs;
    return true;
  }
  if (book.holder || book.queue.length > 0) return false;
  book.holder = hold(caller, "background", now, ttlMs);
  return true;
}

export function applyHeartbeat(
  book: SlotBook,
  id: string,
  now: number,
  ttlMs: number,
  queueTtlMs: number,
): boolean {
  const caller = String(id || "").trim();
  expire(book, now, queueTtlMs);
  if (!caller || book.holder?.id !== caller) return false;
  book.holder.heartbeatAt = now;
  book.holder.expiresAt = now + ttlMs;
  return true;
}

export function applyRelease(
  book: SlotBook,
  id: string,
  now: number,
  queueTtlMs: number,
): void {
  const caller = String(id || "").trim();
  expire(book, now, queueTtlMs);
  if (!caller) return;
  if (book.holder?.id === caller) book.holder = null;
  book.queue = book.queue.filter((entry) => entry.id !== caller);
}
