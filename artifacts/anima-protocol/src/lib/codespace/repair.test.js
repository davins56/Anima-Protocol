import { describe, it, expect } from "vitest";
import { summarizeRunErrors, buildRepairGoal } from "./repair.js";

describe("summarizeRunErrors", () => {
  it("reports ok when there are no error-level logs", () => {
    const r = summarizeRunErrors(
      [
        { level: "info", text: "starting" },
        { level: "log", text: "42" },
      ],
      false,
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("collects error-level logs and marks the run failed", () => {
    const r = summarizeRunErrors(
      [
        { level: "log", text: "hi" },
        { level: "error", text: "ReferenceError: x is not defined" },
      ],
      false,
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("ReferenceError: x is not defined");
  });

  it("treats a timeout as a failure even with no error logs", () => {
    const r = summarizeRunErrors([{ level: "log", text: "loop" }], true);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /timed out/i.test(e))).toBe(true);
  });

  it("de-duplicates repeated identical errors", () => {
    const r = summarizeRunErrors(
      [
        { level: "error", text: "boom" },
        { level: "error", text: "boom" },
        { level: "error", text: "boom" },
      ],
      false,
    );
    expect(r.errors).toEqual(["boom"]);
  });

  it("is safe with empty / missing input", () => {
    expect(summarizeRunErrors()).toEqual({ ok: true, errors: [] });
    expect(summarizeRunErrors(null, false).ok).toBe(true);
  });
});

describe("buildRepairGoal", () => {
  it("names the file, the run mode, and lists the errors", () => {
    const goal = buildRepairGoal({
      path: "main.py",
      mode: "python",
      errors: ["NameError: name 'foo' is not defined"],
    });
    expect(goal).toContain("`main.py`");
    expect(goal).toContain('run mode "python"');
    expect(goal).toContain("- NameError: name 'foo' is not defined");
    expect(goal).toMatch(/repeat until the run succeeds/i);
  });

  it("still produces a usable goal when no error text was captured", () => {
    const goal = buildRepairGoal({ path: "app.js", mode: "js", errors: [] });
    expect(goal).toContain("`app.js`");
    expect(goal).toMatch(/reproduce it by running the file/i);
  });

  it("falls back to a generic label when no path is given", () => {
    const goal = buildRepairGoal({});
    expect(goal).toContain("the active file");
  });
});
