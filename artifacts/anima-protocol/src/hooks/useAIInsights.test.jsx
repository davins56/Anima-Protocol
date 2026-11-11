import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/api/animaClient", () => ({
  animaClient: { functions: { invoke: vi.fn() } },
}));

import { animaClient } from "@/api/animaClient";
import {
  normalizeInsights,
  shouldAutoAnalyze,
  useAIInsights,
  INSIGHTS_EVERY_N_MESSAGES,
} from "./useAIInsights";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const msgs = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));

function mount(initialProps) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const result = { current: undefined };
  function Host({ sessionId, messages }) {
    result.current = useAIInsights(sessionId, messages);
    return null;
  }
  const render = async (props) => {
    await act(async () => {
      root.render(<Host {...props} />);
    });
  };
  return { result, render, unmount: () => act(() => root.unmount()), first: render(initialProps) };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("shouldAutoAnalyze", () => {
  it("needs enough messages, a new batch, and no call in flight", () => {
    expect(shouldAutoAnalyze({ messageCount: 4, lastAttemptCount: 0, inFlight: false })).toBe(false);
    expect(shouldAutoAnalyze({ messageCount: 11, lastAttemptCount: 0, inFlight: false })).toBe(true);
    expect(shouldAutoAnalyze({ messageCount: 11, lastAttemptCount: 0, inFlight: true })).toBe(false);
    expect(shouldAutoAnalyze({ messageCount: 20, lastAttemptCount: 11, inFlight: false })).toBe(false);
    expect(
      shouldAutoAnalyze({ messageCount: 12 + INSIGHTS_EVERY_N_MESSAGES, lastAttemptCount: 11, inFlight: false }),
    ).toBe(true);
  });
});

describe("normalizeInsights", () => {
  it("wraps the summary string the server returns", () => {
    expect(normalizeInsights("  Trust is the theme. ")).toMatchObject({ summary: "Trust is the theme." });
  });
  it("keeps objects, unwraps { data }, drops empty / null", () => {
    expect(normalizeInsights({ data: { summary: "x" } })).toEqual({ summary: "x" });
    expect(normalizeInsights({ summary: "y" })).toEqual({ summary: "y" });
    expect(normalizeInsights(null)).toBeNull();
    expect(normalizeInsights("")).toBeNull();
    expect(normalizeInsights({})).toBeNull();
  });
});

describe("useAIInsights", () => {
  beforeEach(() => {
    animaClient.functions.invoke.mockReset();
  });

  it("a failing server is asked ONCE per batch, not in a retry loop", async () => {
    // The invoke helper resolves null on any HTTP error (500, 429...).
    animaClient.functions.invoke.mockResolvedValue(null);
    const h = mount({ sessionId: "s1", messages: msgs(30) });
    await h.first;
    for (let i = 0; i < 10; i++) await flush();
    expect(animaClient.functions.invoke).toHaveBeenCalledTimes(1);

    // Fewer than a batch of new messages: still no retry.
    await h.render({ sessionId: "s1", messages: msgs(35) });
    await flush();
    expect(animaClient.functions.invoke).toHaveBeenCalledTimes(1);

    // A new batch: one more attempt.
    await h.render({ sessionId: "s1", messages: msgs(41) });
    for (let i = 0; i < 5; i++) await flush();
    expect(animaClient.functions.invoke).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it("a successful summary string shows and does not re-run", async () => {
    animaClient.functions.invoke.mockResolvedValue("The story keeps circling trust.");
    const h = mount({ sessionId: "s1", messages: msgs(12) });
    await h.first;
    for (let i = 0; i < 5; i++) await flush();
    expect(animaClient.functions.invoke).toHaveBeenCalledTimes(1);
    expect(h.result.current.insights).toMatchObject({ summary: "The story keeps circling trust." });
    h.unmount();
  });

  it("a thrown error is handled and not retried", async () => {
    animaClient.functions.invoke.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mount({ sessionId: "s1", messages: msgs(12) });
    await h.first;
    for (let i = 0; i < 5; i++) await flush();
    expect(animaClient.functions.invoke).toHaveBeenCalledTimes(1);
    expect(h.result.current.loading).toBe(false);
    warn.mockRestore();
    h.unmount();
  });
});
