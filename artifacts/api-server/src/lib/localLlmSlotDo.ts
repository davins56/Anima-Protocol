/**
 * Durable Object for the single local Ollama slot.
 * One instance (`getByName("ollama")`) serializes every isolate.
 * Storage is the book; a dead holder expires on the next call.
 */

import { DurableObject } from "cloudflare:workers";
import {
  LLM_LOCAL_SLOT_QUEUE_TTL_MS,
  LLM_LOCAL_SLOT_TTL_MS,
} from "./chatTimeouts";
import {
  applyChatStep,
  applyHeartbeat,
  applyRelease,
  applyTryBackground,
  emptySlotBook,
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
      ),
    );
  }

  async tryBackground(id: string): Promise<boolean> {
    return this.mutate((book, now) =>
      applyTryBackground(
        book,
        id,
        now,
        LLM_LOCAL_SLOT_TTL_MS,
        LLM_LOCAL_SLOT_QUEUE_TTL_MS,
      ),
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
    const book = stored ?? emptySlotBook();
    const result = fn(book, Date.now());
    await this.ctx.storage.put(STORAGE_KEY, book);
    return result;
  }
}
