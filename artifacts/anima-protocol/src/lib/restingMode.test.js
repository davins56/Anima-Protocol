import { describe, expect, it } from "vitest";
import { isRestingError, restingCopy, restingNotice, withRestingNotice } from "./restingMode";
import { messagesForModel } from "./aiCompanionNotice";

describe("resting mode (client)", () => {
  it("detects resting errors", () => {
    expect(isRestingError(Object.assign(new Error("x"), { resting: true }))).toBe(true);
    expect(isRestingError(new Error("x"))).toBe(false);
  });
  it("builds an in-character notice kept out of the model transcript", () => {
    const n = restingNotice({ name: "Aeland", turnId: "t1", queued: true });
    expect(n).toMatchObject({ role: "system", type: "resting_notice", turn_id: "t1" });
    expect(n.content).toBe(restingCopy("Aeland"));
    expect(messagesForModel([{ role: "user", content: "hi" }, n])).toHaveLength(1);
  });
  it("replaces the notice for the same turn", () => {
    const a = restingNotice({ turnId: "t1" });
    const b = restingNotice({ turnId: "t1", message: "She is resting." });
    const out = withRestingNotice(withRestingNotice([{ role: "user", content: "hi" }], a), b);
    expect(out).toHaveLength(2);
    expect(out[1].content).toBe("She is resting.");
  });
});
