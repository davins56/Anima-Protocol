import { describe, expect, it } from "vitest";
import { cueDueAt, dueThread, extractOpenThreads, threadFollowUpInstruction } from "../src/lib/agencyThreads";
import { isKernelFeatureEnabled } from "../src/lib/kernelFeatures";

// Wednesday 2026-10-21 18:00 UTC
const WED = Date.parse("2026-10-21T18:00:00Z");
const msg = (role: string, content: string, at: number) => ({ role, content, timestamp: new Date(at).toISOString() });

describe("thread-based follow-ups (agency)", () => {
  it("is behind ANIMA_KERNEL_AGENCY, default off", () => {
    expect(isKernelFeatureEnabled("agency", {})).toBe(false);
    expect(isKernelFeatureEnabled("agency", { ANIMA_KERNEL_AGENCY: "1" })).toBe(true);
  });

  it("dates common cues after the event", () => {
    expect(new Date(cueDueAt("interview tomorrow", WED)!).toISOString()).toBe("2026-10-23T09:00:00.000Z");
    expect(new Date(cueDueAt("my recital is on Friday", WED)!).toISOString()).toBe("2026-10-24T09:00:00.000Z");
    expect(cueDueAt("I like interviews", WED)).toBeNull();
  });

  it("finds an open thread and follows up once it's due", () => {
    const messages = [
      msg("user", "Long day. My recital is on Friday and I'm terrified.", WED),
      msg("assistant", "You'll carry it. I'll be thinking of you.", WED + 60_000),
    ];
    const threads = extractOpenThreads(messages);
    expect(threads).toHaveLength(1);
    expect(threads[0].eventWord).toBe("recital");
    expect(dueThread(threads, WED + 1 * 86_400_000)).toBeNull(); // Thursday: not yet
    const due = dueThread(threads, Date.parse("2026-10-25T12:00:00Z"));
    expect(due?.topic).toContain("recital is on Friday");
    expect(threadFollowUpInstruction(due!)).toMatch(/how the recital went/);
    expect(dueThread(threads, Date.parse("2026-11-10T00:00:00Z"))).toBeNull(); // stale
  });

  it("treats a thread as closed once it was talked about after it happened", () => {
    const messages = [
      msg("user", "Job interview tomorrow!", WED),
      msg("user", "The interview went okay I think.", Date.parse("2026-10-23T12:00:00Z")),
    ];
    expect(extractOpenThreads(messages)).toEqual([]);
  });

  it("ignores the companion's own lines", () => {
    expect(extractOpenThreads([msg("assistant", "Your exam is tomorrow, right?", WED)])).toEqual([]);
  });
});
