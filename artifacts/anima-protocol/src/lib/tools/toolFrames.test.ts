import { describe, it, expect } from "vitest";
import {
  applyToolFrame,
  parseToolFrame,
  isWaitingForUser,
  canStop,
  toolsUiEnabled,
  safeHttpUrl,
  actionsForTurn,
  type ToolActionMap,
} from "./toolFrames";

const base = { action_id: "a1", tool: "web_search", turn_id: "turn_1", user_message_id: "turn_1:user" };

describe("toolsUiEnabled", () => {
  it("is off by default", () => {
    expect(toolsUiEnabled({})).toBe(false);
    expect(toolsUiEnabled({ VITE_ANIMA_TOOLS: "1" })).toBe(true);
  });
});

describe("parseToolFrame", () => {
  it("rejects frames without an id, a known event or a positive integer seq", () => {
    expect(parseToolFrame(null)).toBeNull();
    expect(parseToolFrame({ ...base, event: "requested", seq: 1 })).toBeNull();
    expect(parseToolFrame({ ...base, event: "started", seq: 0 })).toBeNull();
    expect(parseToolFrame({ ...base, event: "started" })).toBeNull();
    expect(parseToolFrame({ event: "started", seq: 1 })).toBeNull();
  });

  it("keeps only http(s) source links", () => {
    const f = parseToolFrame({
      ...base,
      event: "succeeded",
      seq: 2,
      result: {
        sources: [
          { id: "1", title: "Good", url: "https://example.com/a", snippet: "s" },
          { id: "2", title: "Bad", url: "javascript:alert(1)" },
          { id: "3", title: "Data", url: "data:text/html,hi" },
        ],
      },
    });
    expect(f?.sources.map((s) => s.title)).toEqual(["Good"]);
    expect(safeHttpUrl("ftp://x")).toBeNull();
  });
});

describe("applyToolFrame", () => {
  it("orders by seq, ignores replays and nothing follows a terminal event", () => {
    let m: ToolActionMap = {};
    m = applyToolFrame(m, { ...base, event: "started", seq: 1, summary: "Search the web" });
    m = applyToolFrame(m, { ...base, event: "progress", seq: 2 });
    m = applyToolFrame(m, { ...base, event: "started", seq: 1 });
    expect(m.a1.event).toBe("progress");
    expect(m.a1.summary).toBe("Search the web");
    m = applyToolFrame(m, {
      ...base,
      event: "succeeded",
      seq: 3,
      result: { sources: [{ id: "s", title: "T", url: "https://e.com", snippet: "" }] },
    });
    m = applyToolFrame(m, { ...base, event: "failed", seq: 4 });
    expect(m.a1.event).toBe("succeeded");
    expect(m.a1.sources).toHaveLength(1);
    expect(canStop(m.a1)).toBe(false);
  });

  it("keeps the confirmation through to the decision", () => {
    let m: ToolActionMap = {};
    m = applyToolFrame(m, {
      ...base,
      tool: "webhook",
      event: "confirmation_required",
      seq: 1,
      confirmation: {
        id: "c1",
        action_kind: "purchase",
        expires_at: "2999-01-01T00:00:00Z",
        request_hash: "abc",
        target: "shop.example",
        payload_summary: "Buy 1 item",
        amount: 12.5,
        currency: "USD",
      },
    });
    expect(isWaitingForUser(m.a1)).toBe(true);
    expect(m.a1.confirmation?.amount).toBe(12.5);
    expect(isWaitingForUser(m.a1, Date.parse("3000-01-01"))).toBe(false);
    m = applyToolFrame(m, { ...base, event: "started", seq: 2 });
    expect(m.a1.confirmation?.target).toBe("shop.example");
    expect(isWaitingForUser(m.a1)).toBe(false);
  });

  it("a confirmation without its request hash is not actionable", () => {
    const m = applyToolFrame({}, {
      ...base,
      event: "confirmation_required",
      seq: 1,
      confirmation: { id: "c1", expires_at: "2999-01-01T00:00:00Z" },
    });
    expect(m.a1.confirmation).toBeNull();
    expect(isWaitingForUser(m.a1)).toBe(false);
  });

  it("groups by turn", () => {
    let m: ToolActionMap = {};
    m = applyToolFrame(m, { ...base, event: "started", seq: 1 });
    m = applyToolFrame(m, { ...base, action_id: "a2", turn_id: "turn_2", event: "started", seq: 1 });
    expect(actionsForTurn(m, "turn_1").map((a) => a.action_id)).toEqual(["a1"]);
  });
});
