import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({
  authHeaders: vi.fn(async (extra = {}) => ({ Authorization: "Bearer test", ...extra })),
}));

import {
  BREADCRUMB_LIMIT,
  DEDUPE_WINDOW_MS,
  MAX_PER_MINUTE,
  apiPathOf,
  buildDiagnosticContext,
  captureApiFailure,
  captureChatFailure,
  captureError,
  captureReactCrash,
  flushBugReports,
  getBreadcrumbs,
  installBugSquasher,
  isIgnoredError,
  recordBreadcrumb,
  resetBugSquasherForTests,
} from "./capture.js";
import { bugSignature, localFingerprint, topFrame } from "./fingerprint.js";
import { scrubText, scrubUrlPath, scrubValue } from "./scrub.js";

let clock = 1_800_000_000_000;
const now = () => clock;

function setup(status = 201) {
  const sent = [];
  const send = vi.fn(async (body) => {
    sent.push(body);
    return { status };
  });
  const uninstall = installBugSquasher({ send, now, instrumentFetch: false, getUserId: () => "user_test1" });
  return { sent, send, uninstall };
}

beforeEach(() => {
  resetBugSquasherForTests();
  clock = 1_800_000_000_000;
});

afterEach(() => {
  resetBugSquasherForTests();
  vi.useRealTimers();
});

describe("client scrubbing", () => {
  it("removes tokens, keys and emails but keeps error text", () => {
    const out = scrubText(
      "Bearer abc.def.ghi failed for davin@example.com token=xyz sk_live_abcdefghijkl eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl",
    );
    expect(out).not.toMatch(/abc\.def\.ghi|davin@example\.com|xyz|sk_live_abcdefghijkl|eyJhbGciOi\./);
    expect(scrubText("TypeError: Cannot read properties of undefined (reading 'x')")).toBe(
      "TypeError: Cannot read properties of undefined (reading 'x')",
    );
  });

  it("drops sensitive keys and query values", () => {
    expect(scrubValue({ token: "a", nested: { password: "b", ok: 1 } })).toEqual({ nested: { ok: 1 } });
    expect(scrubUrlPath("/chat/x?token=abc&tab=1")).toBe("/chat/x?token=[redacted]&tab=…");
  });
});

describe("client fingerprints", () => {
  it("match across bundle hashes and volatile ids", () => {
    const a = localFingerprint({ kind: "window_error", message: "boom 42", stack: "at f (https://x/assets/a-AAAA1111.js:1:2)" });
    const b = localFingerprint({ kind: "window_error", message: "boom 99", stack: "at f (https://x/assets/a-BBBB2222.js:9:9)" });
    expect(a).toBe(b);
    expect(topFrame("g@https://x/assets/Chat-Zz9Yy8Xx.js:1:1")).toBe("g@Chat.js");
    expect(bugSignature({ kind: "api_error", api: { method: "post", path: "/api/x/123", status: 502 } })).toBe(
      "api|POST|/api/x/:id|502",
    );
  });
});

describe("capture", () => {
  it("does nothing before install", async () => {
    expect(captureError("window_error", new Error("x"))).toBe(false);
  });

  it("sends a scrubbed crash report with context", async () => {
    const { sent } = setup();
    recordBreadcrumb("nav", "/chat/s1");
    const err = new Error("Render failed for token=supersecret");
    expect(captureReactCrash(err, { componentStack: "\n    at ChatView" })).toBe(true);
    await flushBugReports();
    expect(sent).toHaveLength(1);
    const body = sent[0];
    expect(body.kind).toBe("react_crash");
    expect(body.message).toContain("Error: Render failed");
    expect(body.message).not.toContain("supersecret");
    expect(body.occurrences).toBe(1);
    expect(body.app_version).toBeTruthy();
    expect(body.context.component_stack).toContain("ChatView");
    expect(body.context.breadcrumbs.some((c) => c.message === "/chat/s1")).toBe(true);
    expect(body.context.user_id).toBe("user_test1");
    expect(body.context.browser).toBeTruthy();
  });

  it("dedupes repeats into one send with an occurrence count", async () => {
    const { sent } = setup();
    for (let i = 0; i < 5; i += 1) captureError("window_error", new Error(`same thing ${i}`));
    await flushBugReports();
    expect(sent).toHaveLength(1);
    expect(sent[0].occurrences).toBe(5);

    // Inside the dedupe window: held, not sent.
    captureError("window_error", new Error("same thing 7"));
    clock += 1000;
    await flushBugReports();
    expect(sent).toHaveLength(1);

    // After the window: sent with the held count.
    clock += DEDUPE_WINDOW_MS;
    await flushBugReports();
    expect(sent).toHaveLength(2);
    expect(sent[1].occurrences).toBe(1);
  });

  it("rate-limits distinct reports per minute", async () => {
    const { sent } = setup();
    for (let i = 0; i < MAX_PER_MINUTE + 5; i += 1) {
      captureError("window_error", new Error(`distinct ${String.fromCharCode(97 + i)}`), {});
    }
    await flushBugReports();
    expect(sent).toHaveLength(MAX_PER_MINUTE);
    clock += 61_000;
    await flushBugReports();
    expect(sent).toHaveLength(MAX_PER_MINUTE + 5);
  });

  it("pauses when the server says the feature is not migrated (503)", async () => {
    const { sent, send } = setup(503);
    captureError("window_error", new Error("a"));
    captureError("window_error", new Error("b"));
    await flushBugReports();
    expect(send).toHaveBeenCalledTimes(1);
    captureError("window_error", new Error("c"));
    clock += 60_000;
    await flushBugReports();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("ignores browser noise and extension errors", () => {
    setup();
    expect(isIgnoredError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isIgnoredError("Script error.")).toBe(true);
    expect(isIgnoredError("x", "at f (chrome-extension://abc/content.js:1:1)")).toBe(true);
    expect(captureError("window_error", new Error("ResizeObserver loop limit exceeded"))).toBe(false);
  });

  it("captures window errors and unhandled rejections from the global listeners", async () => {
    const { sent } = setup();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("global boom"), message: "global boom" }));
    const rejection = new Event("unhandledrejection");
    rejection.reason = new Error("async boom");
    window.dispatchEvent(rejection);
    await flushBugReports();
    expect(sent.map((b) => b.kind).sort()).toEqual(["unhandled_rejection", "window_error"]);
  });

  it("files API failures and chat failures with their own grouping context", async () => {
    const { sent } = setup();
    captureApiFailure({ method: "post", url: "/api/chat/messages?token=x", status: 502, durationMs: 1234 });
    captureChatFailure({
      failureType: "post",
      phase: "post",
      message: "The companion returned an empty reply. Please try again.",
      code: "empty_reply",
      sessionId: "sess_1",
      turnId: "turn_1",
      partialKept: false,
      msToFailure: 900,
    });
    await flushBugReports();
    const api = sent.find((b) => b.kind === "api_error");
    const chat = sent.find((b) => b.kind === "chat_failure");
    expect(api.context.api).toMatchObject({ method: "POST", path: "/api/chat/messages", status: 502 });
    expect(api.title).toBe("POST /api/chat/messages → 502");
    expect(chat.context.chat).toMatchObject({ failure_type: "post", phase: "post", code: "empty_reply", turn_id: "turn_1" });
  });

  it("keeps a bounded breadcrumb ring", () => {
    for (let i = 0; i < BREADCRUMB_LIMIT + 10; i += 1) recordBreadcrumb("ui", `step ${i}`);
    const crumbs = getBreadcrumbs();
    expect(crumbs).toHaveLength(BREADCRUMB_LIMIT);
    expect(crumbs.at(-1).message).toBe(`step ${BREADCRUMB_LIMIT + 9}`);
  });

  it("diagnostic context never includes message text fields", () => {
    const ctx = buildDiagnosticContext();
    expect(Object.keys(ctx).sort()).toEqual(["app_version", "breadcrumbs", "browser", "captured_at", "recent_errors", "route"]);
  });
});

describe("fetch instrumentation", () => {
  it("reports 5xx and network failures for /api calls only, and never its own endpoint", async () => {
    const responses = {
      "/api/store/x": { status: 500 },
      "/api/ok": { status: 200 },
      "/api/bug-squasher/reports": { status: 500 },
      "https://elsewhere.example/api/x": { status: 500 },
    };
    const realFetch = window.fetch;
    window.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/api/net")) throw new TypeError("Failed to fetch");
      return responses[String(url)] || { status: 200 };
    });
    const sent = [];
    const uninstall = installBugSquasher({
      send: async (b) => {
        sent.push(b);
        return { status: 201 };
      },
      now,
    });
    try {
      await window.fetch("/api/store/x");
      await window.fetch("/api/ok");
      await window.fetch("/api/bug-squasher/reports", { method: "POST" });
      await window.fetch("https://elsewhere.example/api/x");
      await window.fetch("/api/net").catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      await flushBugReports();
      const paths = sent.map((b) => `${b.context.api.path}:${b.context.api.status}`).sort();
      expect(paths).toEqual(["/api/net:0", "/api/store/x:500"]);
      expect(getBreadcrumbs().some((c) => c.message === "GET /api/ok 200")).toBe(true);
    } finally {
      uninstall();
      window.fetch = realFetch;
    }
  });

  it("recognises same-origin /api paths", () => {
    expect(apiPathOf("/api/chat/messages")).toBe("/api/chat/messages");
    expect(apiPathOf(`${window.location.origin}/api/x?y=1`)).toBe("/api/x");
    expect(apiPathOf("/assets/x.js")).toBe("");
    expect(apiPathOf("/api/__clerk/v1/client")).toBe("");
    expect(apiPathOf("https://other.example/api/x")).toBe("");
  });
});
