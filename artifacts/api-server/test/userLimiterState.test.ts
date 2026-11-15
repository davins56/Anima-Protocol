import { describe, expect, it } from "vitest";
import {
  applyHit,
  applyRefund,
  normalizeBook,
  sanitizeRules,
  windowStartFor,
} from "../src/lib/usage/limiterState";

const MIN = 60_000;
const DAY = 86_400_000;
const rules = [
  { name: "photo:min", max: 2, windowMs: MIN },
  { name: "photo:day", max: 3, windowMs: DAY },
];

describe("per-user limiter state", () => {
  it("counts each rule and blocks with the longest wait", () => {
    const book = normalizeBook(null);
    const t0 = DAY * 100 + 10_000;
    expect(applyHit(book, rules, 1, t0).allowed).toBe(true);
    expect(applyHit(book, rules, 1, t0 + 1).allowed).toBe(true);
    const blocked = applyHit(book, rules, 1, t0 + 2);
    expect(blocked).toMatchObject({ allowed: false, rule: "photo:min" });
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBe(windowStartFor(t0, MIN) + MIN - (t0 + 2));

    // Next minute: the minute rule resets, the day rule has one left.
    expect(applyHit(book, rules, 1, t0 + MIN).allowed).toBe(true);
    const dayBlocked = applyHit(book, rules, 1, t0 + MIN + 1);
    expect(dayBlocked).toMatchObject({ allowed: false, rule: "photo:day" });
  });

  it("is all-or-nothing: a blocked hit counts against no rule", () => {
    const book = normalizeBook(null);
    const t = DAY * 5;
    applyHit(book, rules, 2, t);
    expect(applyHit(book, rules, 1, t).allowed).toBe(false);
    // Day bucket still at 2, not 3.
    expect(applyHit(book, rules, 1, t + MIN)).toMatchObject({ allowed: true, remaining: { "photo:day": 0 } });
  });

  it("refunds only within the current window", () => {
    const book = normalizeBook(null);
    const t = DAY * 7;
    applyHit(book, rules, 1, t);
    applyHit(book, rules, 1, t);
    applyRefund(book, rules, 1, t);
    expect(applyHit(book, rules, 1, t).allowed).toBe(true);
    // A refund in a later minute window leaves the old minute alone but
    // still returns the day unit.
    applyRefund(book, rules, 1, t + MIN);
    expect(applyHit(book, [rules[1]!], 1, t + MIN)).toMatchObject({ allowed: true, remaining: { "photo:day": 1 } });
  });

  it("max 0 blocks everything", () => {
    const book = normalizeBook(null);
    expect(applyHit(book, [{ name: "x", max: 0, windowMs: MIN }], 1, 0).allowed).toBe(false);
  });

  it("sanitizes rules arriving over the DO RPC boundary", () => {
    expect(
      sanitizeRules([
        { name: "ok", max: 3, windowMs: MIN },
        { name: "", max: 3, windowMs: MIN },
        { name: "tiny", max: 3, windowMs: 10 },
        { name: "huge", max: 3, windowMs: DAY * 400 },
        "junk",
      ]),
    ).toEqual([{ name: "ok", max: 3, windowMs: MIN }]);
    expect(sanitizeRules("nope")).toEqual([]);
  });

  it("drops corrupt stored buckets", () => {
    expect(normalizeBook({ buckets: { a: { windowStart: "x", used: 1 }, b: { windowStart: 0, used: 2 } } })).toEqual({
      buckets: { b: { windowStart: 0, used: 2 } },
    });
  });
});
