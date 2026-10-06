/**
 * Single-slot book for the local Ollama host.
 * One holder. Chat turns wait FIFO and are always ahead of background work.
 * A background holder is asked to yield when a chat turn arrives, and is
 * dropped after `yieldMs` (or its wall deadline) so the chat turn can take
 * the slot. TTL still clears a dead holder.
 * The Durable Object and the in-process coordinator both apply these
 * functions. Mutations are synchronous so two callers cannot both pass.
 */

import {
  LLM_BACKGROUND_SLOT_TTL_MS,
  LLM_BACKGROUND_WALL_MS,
  LLM_BACKGROUND_YIELD_MS,
} from "./chatTimeouts";

export type SlotKind = "chat" | "background";

export type SlotHolder = {
  id: string;
  kind: SlotKind;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
  /** How far each heartbeat extends the lease. */
  leaseMs: number;
  /** Set when a chat turn wants the slot from a background holder. */
  yieldRequestedAt: number | null;
  /** Absolute time a background holder must be gone, heartbeats included. */
  wallDeadline: number | null;
};

export type SlotQueueEntry = {
  id: string;
  enqueuedAt: number;
  touchedAt: number;
};

export type SlotBook = {
  holder: SlotHolder | null;
  /** Chat turns, arrival order. */
  queue: SlotQueueEntry[];
  /** Background jobs waiting until no chat turn wants the slot. */
  backgroundQueue: SlotQueueEntry[];
};

export type SlotStep = {
  granted: boolean;
  position: number;
  /** A background holder has been asked to abort. */
  yielding?: boolean;
};

export type BackgroundPoll = {
  held: boolean;
  /** Chat is waiting, or this holder is past its wall clock. */
  yield: boolean;
};

export function emptySlotBook(): SlotBook {
  return { holder: null, queue: [], backgroundQueue: [] };
}

/** Old Durable Object rows predate the background queue and yield fields. */
export function normalizeSlotBook(stored: SlotBook | null | undefined): SlotBook {
  const book = stored ?? emptySlotBook();
  if (!Array.isArray(book.queue)) book.queue = [];
  if (!Array.isArray(book.backgroundQueue)) book.backgroundQueue = [];
  const holder = book.holder;
  if (holder) {
    if (typeof holder.leaseMs !== "number" || holder.leaseMs <= 0) {
      holder.leaseMs =
        holder.kind === "background" ? LLM_BACKGROUND_SLOT_TTL_MS : holder.expiresAt - holder.acquiredAt;
    }
    if (holder.yieldRequestedAt === undefined) holder.yieldRequestedAt = null;
    if (holder.wallDeadline === undefined) {
      holder.wallDeadline =
        holder.kind === "background" ? holder.acquiredAt + LLM_BACKGROUND_WALL_MS : null;
    }
  }
  return book;
}

function expire(book: SlotBook, now: number, queueTtlMs: number): void {
  const holder = book.holder;
  if (holder && (holder.expiresAt <= now || (holder.wallDeadline != null && holder.wallDeadline <= now))) {
    book.holder = null;
  }
  if (queueTtlMs > 0) {
    const live = (entry: SlotQueueEntry) => now - entry.touchedAt < queueTtlMs;
    book.queue = book.queue.filter(live);
    book.backgroundQueue = book.backgroundQueue.filter(live);
  }
}

function hold(
  id: string,
  kind: SlotKind,
  now: number,
  leaseMs: number,
  wallMs: number | null,
): SlotHolder {
  return {
    id,
    kind,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: now + leaseMs,
    leaseMs,
    yieldRequestedAt: null,
    wallDeadline: wallMs != null ? now + wallMs : null,
  };
}

function touchQueue(queue: SlotQueueEntry[], id: string, now: number): number {
  const mine = queue.findIndex((entry) => entry.id === id);
  if (mine >= 0) {
    queue[mine]!.touchedAt = now;
    return mine;
  }
  queue.push({ id, enqueuedAt: now, touchedAt: now });
  return queue.length - 1;
}

/**
 * Drop a background holder once chat has waited out the yield bound, or the
 * holder's own wall clock has passed. Chat can then take the slot in the
 * same step.
 */
function preemptBackground(book: SlotBook, now: number, yieldMs: number): void {
  const holder = book.holder;
  if (!holder || holder.kind !== "background") return;
  if (holder.yieldRequestedAt == null) holder.yieldRequestedAt = now;
  const yieldHit = now >= holder.yieldRequestedAt + Math.max(0, yieldMs);
  const wallHit = holder.wallDeadline != null && now >= holder.wallDeadline;
  if (yieldHit || wallHit) book.holder = null;
}

/**
 * Chat turns take the slot in arrival order, ahead of any queued background
 * job. A background holder is marked to yield and kept only until `yieldMs`.
 */
export function applyChatStep(
  book: SlotBook,
  turnId: string,
  now: number,
  ttlMs: number,
  queueTtlMs: number,
  yieldMs: number = LLM_BACKGROUND_YIELD_MS,
): SlotStep {
  const id = String(turnId || "").trim();
  normalizeSlotBook(book);
  expire(book, now, queueTtlMs);
  if (!id) return { granted: false, position: 0 };
  if (book.holder?.id === id && book.holder.kind === "chat") {
    book.holder.heartbeatAt = now;
    book.holder.expiresAt = now + ttlMs;
    book.holder.leaseMs = ttlMs;
    return { granted: true, position: 0 };
  }
  preemptBackground(book, now, yieldMs);
  const yielding = book.holder?.kind === "background";
  const mine = book.queue.findIndex((entry) => entry.id === id);
  const head = book.queue[0]?.id;
  const canTake = !book.holder && (book.queue.length === 0 || head === id);
  if (canTake) {
    if (mine >= 0) book.queue.splice(mine, 1);
    book.holder = hold(id, "chat", now, ttlMs, null);
    return { granted: true, position: 0 };
  }
  if (mine >= 0) {
    book.queue[mine]!.touchedAt = now;
  } else {
    book.queue.push({ id, enqueuedAt: now, touchedAt: now });
  }
  const position = book.queue.findIndex((entry) => entry.id === id) + 1;
  return { granted: false, position, yielding };
}

/**
 * Background work never runs ahead of a chat holder or a waiting chat turn.
 * Only the head of the background queue may take a free slot. Skip (false)
 * when chat is using or waiting for the model.
 */
export function applyTryBackground(
  book: SlotBook,
  id: string,
  now: number,
  ttlMs: number,
  queueTtlMs: number,
  background: { leaseMs: number; wallMs: number } = {
    leaseMs: LLM_BACKGROUND_SLOT_TTL_MS,
    wallMs: LLM_BACKGROUND_WALL_MS,
  },
): boolean {
  const caller = String(id || "").trim();
  normalizeSlotBook(book);
  expire(book, now, queueTtlMs);
  if (!caller) return false;
  if (book.holder?.id === caller) {
    book.holder.heartbeatAt = now;
    const lease = book.holder.leaseMs > 0 ? book.holder.leaseMs : background.leaseMs;
    let expires = now + lease;
    if (book.holder.wallDeadline != null) expires = Math.min(expires, book.holder.wallDeadline);
    book.holder.expiresAt = expires;
    return book.holder.expiresAt > now;
  }
  if (book.holder || book.queue.length > 0) return false;
  const queuedHead = book.backgroundQueue[0]?.id;
  if (book.backgroundQueue.length > 0 && queuedHead !== caller) return false;
  const mine = book.backgroundQueue.findIndex((entry) => entry.id === caller);
  if (mine >= 0) book.backgroundQueue.splice(mine, 1);
  book.holder = hold(caller, "background", now, background.leaseMs, background.wallMs);
  return true;
}

/**
 * Park a background job behind every chat turn. Does not take the slot.
 * Returns the 1-based place in the background queue.
 */
export function applyEnqueueBackground(
  book: SlotBook,
  id: string,
  now: number,
  queueTtlMs: number,
): number {
  const caller = String(id || "").trim();
  normalizeSlotBook(book);
  expire(book, now, queueTtlMs);
  if (!caller) return 0;
  if (book.holder?.id === caller) return 0;
  touchQueue(book.backgroundQueue, caller, now);
  return book.backgroundQueue.findIndex((entry) => entry.id === caller) + 1;
}

export function applyPollBackground(
  book: SlotBook,
  id: string,
  now: number,
  queueTtlMs: number,
): BackgroundPoll {
  const caller = String(id || "").trim();
  normalizeSlotBook(book);
  expire(book, now, queueTtlMs);
  if (!caller || book.holder?.id !== caller || book.holder.kind !== "background") {
    return { held: false, yield: true };
  }
  const lease = book.holder.leaseMs > 0 ? book.holder.leaseMs : LLM_BACKGROUND_SLOT_TTL_MS;
  let expires = now + lease;
  if (book.holder.wallDeadline != null) expires = Math.min(expires, book.holder.wallDeadline);
  book.holder.heartbeatAt = now;
  book.holder.expiresAt = expires;
  const wallHit = book.holder.wallDeadline != null && now >= book.holder.wallDeadline;
  return {
    held: expires > now && !wallHit,
    yield: book.holder.yieldRequestedAt != null || wallHit,
  };
}

export function applyHeartbeat(
  book: SlotBook,
  id: string,
  now: number,
  ttlMs: number,
  queueTtlMs: number,
): boolean {
  const caller = String(id || "").trim();
  normalizeSlotBook(book);
  expire(book, now, queueTtlMs);
  if (!caller || book.holder?.id !== caller) return false;
  const lease = book.holder.leaseMs > 0 ? book.holder.leaseMs : ttlMs;
  let expires = now + lease;
  if (book.holder.wallDeadline != null) expires = Math.min(expires, book.holder.wallDeadline);
  book.holder.heartbeatAt = now;
  book.holder.expiresAt = expires;
  return expires > now;
}

export function applyRelease(
  book: SlotBook,
  id: string,
  now: number,
  queueTtlMs: number,
): void {
  const caller = String(id || "").trim();
  normalizeSlotBook(book);
  expire(book, now, queueTtlMs);
  if (!caller) return;
  if (book.holder?.id === caller) book.holder = null;
  book.queue = book.queue.filter((entry) => entry.id !== caller);
  book.backgroundQueue = book.backgroundQueue.filter((entry) => entry.id !== caller);
}
