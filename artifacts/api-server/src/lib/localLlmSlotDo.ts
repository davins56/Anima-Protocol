/**
 * Durable Object for the single local Ollama slot.
 * One instance (`getByName("ollama")`) serializes every isolate.
 * Storage is the book; a dead holder expires on the next call.
 * Storage get/put is the critical section. In-process callers serialize on a
 * promise chain in `localLlmSlot.ts`. Book mutations themselves are synchronous.
 */

import { DurableObject } from "cloudflare:workers";
import {
  LLM_BACKGROUND_SLOT_TTL_MS,
  LLM_BACKGROUND_WALL_MS,
  LLM_BACKGROUND_YIELD_MS,
  LLM_LOCAL_SLOT_QUEUE_TTL_MS,
  LLM_LOCAL_SLOT_TTL_MS,
} from "./chatTimeouts";
import {
  applyChatStep,
  applyEnqueueBackground,
  applyHeartbeat,
  applyPollBackground,
  applyRelease,
  applyTryBackground,
  normalizeSlotBook,
  type BackgroundPoll,
  type SlotBook,
  type SlotStep,
} from "./localLlmSlotState";

const STORAGE_KEY = "book";

export class LocalLlmSlot extends DurableObject {
  async chatStep(turnId: string): Promise<SlotStep> {
    return this.mutate((book, now) =>
      applyChatStep(
        book,
        turnId,
        now,
        LLM_LOCAL_SLOT_TTL_MS,
        LLM_LOCAL_SLOT_QUEUE_TTL_MS,
        LLM_BACKGROUND_YIELD_MS,
      ),
    );
  }

  async tryBackground(id: string, wallMs?: number | null): Promise<boolean> {
    const wall =
      wallMs === null
        ? null
        : typeof wallMs === "number" && Number.isFinite(wallMs) && wallMs > 0
          ? wallMs
          : LLM_BACKGROUND_WALL_MS;
    return this.mutate((book, now) =>
      applyTryBackground(
        book,
        id,
        now,
        LLM_LOCAL_SLOT_TTL_MS,
        LLM_LOCAL_SLOT_QUEUE_TTL_MS,
        { leaseMs: LLM_BACKGROUND_SLOT_TTL_MS, wallMs: wall },
      ),
    );
  }

  async enqueueBackground(id: string): Promise<number> {
    return this.mutate((book, now) =>
      applyEnqueueBackground(book, id, now, LLM_LOCAL_SLOT_QUEUE_TTL_MS),
    );
  }

  async pollBackground(id: string): Promise<BackgroundPoll> {
    return this.mutate((book, now) =>
      applyPollBackground(book, id, now, LLM_LOCAL_SLOT_QUEUE_TTL_MS),
    );
  }

  async heartbeat(id: string): Promise<boolean> {
    return this.mutate((book, now) =>
      applyHeartbeat(
        book,
        id,
        now,
        LLM_LOCAL_SLOT_TTL_MS,
        LLM_LOCAL_SLOT_QUEUE_TTL_MS,
      ),
    );
  }

  async release(id: string): Promise<void> {
    await this.mutate((book, now) => {
      applyRelease(book, id, now, LLM_LOCAL_SLOT_QUEUE_TTL_MS);
    });
  }

  private async mutate<T>(fn: (book: SlotBook, now: number) => T): Promise<T> {
    const stored = await this.ctx.storage.get<SlotBook>(STORAGE_KEY);
    const book = normalizeSlotBook(stored);
    const result = fn(book, Date.now());
    await this.ctx.storage.put(STORAGE_KEY, book);
    return result;
  }
}
