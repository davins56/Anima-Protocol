/**
 * Durable Object: one instance per user (`getByName("u:<clerk user id>")`).
 * Holds that user's fixed-window counters for the paid AI endpoints so the
 * limit holds across Worker isolates (security audit 2026-11-14 H1).
 * SQLite-backed (wrangler `new_sqlite_classes`, tag v2-user-rate-limiter).
 */

import { DurableObject } from "cloudflare:workers";
import {
  applyHit,
  applyRefund,
  normalizeBook,
  sanitizeRules,
  type HitResult,
  type LimiterBook,
} from "./limiterState";

const STORAGE_KEY = "book";

export class UserRateLimiter extends DurableObject {
  async hit(rules: unknown, cost: number): Promise<HitResult> {
    return this.mutate((book, now) => applyHit(book, sanitizeRules(rules), cost, now));
  }

  async refund(rules: unknown, cost: number): Promise<void> {
    await this.mutate((book, now) => applyRefund(book, sanitizeRules(rules), cost, now));
  }

  private async mutate<T>(fn: (book: LimiterBook, now: number) => T): Promise<T> {
    const book = normalizeBook(await this.ctx.storage.get<LimiterBook>(STORAGE_KEY));
    const result = fn(book, Date.now());
    await this.ctx.storage.put(STORAGE_KEY, book);
    return result;
  }
}
