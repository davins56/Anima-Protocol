import { describe, expect, it } from "vitest";
import { isModelResting, restingDisposition, restingLine, RESTING_EXPIRE_HOURS, RESTING_MAX_ATTEMPTS } from "../src/lib/restingMode";

describe("resting mode", () => {
  it("treats tunnel / Ollama-down failures before any token as resting", () => {
    expect(isModelResting(Object.assign(new Error("connect ECONNREFUSED 10.0.0.2:11434"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isModelResting(new Error("fetch failed"))).toBe(true);
    expect(isModelResting(new Error("error code: 1033"))).toBe(true);
    expect(isModelResting(Object.assign(new Error("Bad Gateway"), { status: 502 }))).toBe(true);
    expect(isModelResting(new Error("Ollama model server is not running"))).toBe(true);
    expect(isModelResting(new Error("x", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) }))).toBe(true);
  });
  it("is not resting for auth/quota/safety errors or once text was generated", () => {
    expect(isModelResting(Object.assign(new Error("bad key"), { code: "authentication_error" }))).toBe(false);
    expect(isModelResting(new Error("content policy violation"))).toBe(false);
    expect(isModelResting(new Error("fetch failed"), 12)).toBe(false);
    expect(isModelResting(null)).toBe(false);
  });
  it("in-character copy without host detail", () => {
    expect(restingLine("Aeland")).toMatch(/^Aeland is resting/);
    expect(restingLine("")).toMatch(/^She is resting/);
    expect(restingLine("Scarlet")).not.toMatch(/ollama|server|tunnel|model/i);
  });
  it("expires old or repeatedly failing queue rows", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    expect(restingDisposition({ created_at: new Date(now - 3600_000), failed_attempts: 0 }, now)).toBe("deliver");
    expect(restingDisposition({ created_at: new Date(now - (RESTING_EXPIRE_HOURS + 1) * 3600_000), failed_attempts: 0 }, now)).toBe("expire");
    expect(restingDisposition({ created_at: new Date(now), failed_attempts: RESTING_MAX_ATTEMPTS }, now)).toBe("expire");
  });
});
