import { describe, expect, it } from "vitest";
import { scrubText, scrubUrlPath, scrubValue, isSensitiveKey } from "../src/lib/bugSquasher/scrub";
import {
  bugFingerprint,
  bugSignature,
  normalizeApiPath,
  normalizeMessage,
  topFrame,
} from "../src/lib/bugSquasher/fingerprint";
import {
  BugReportInputError,
  cleanContext,
  cleanScreenshot,
  parseBugReport,
  parseStatusUpdate,
} from "../src/lib/bugSquasher/ingest";

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJlLXBhcnQtaGVyZQ";

describe("bug squasher scrubbing", () => {
  it("redacts bearer tokens, JWTs and known key shapes", () => {
    const text = scrubText(
      `Authorization: Bearer abc.def.ghi failed; jwt=${JWT}; key sk_live_${"a".repeat(24)} ` +
        `openrouter sk-or-v1-${"b".repeat(40)} gh ghp_${"c".repeat(36)} aws AKIAABCDEFGHIJKLMNOP`,
    );
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain(JWT);
    expect(text).not.toContain("sk_live_");
    expect(text).not.toContain("sk-or-v1");
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(text).toContain("[redacted]");
  });

  it("redacts credential key=value pairs, emails, connection strings and data URLs", () => {
    const text = scrubText(
      `GET /api/x?token=s3cr3t&api_key=abc123 {"password": "hunter2"} mail davin@example.com ` +
        `postgres://u:p@db.host:5432/app data:image/png;base64,${"A".repeat(64)}`,
    );
    expect(text).not.toMatch(/s3cr3t|abc123|hunter2|davin@example\.com|u:p@db/);
    expect(text).toContain("[email]");
    expect(text).toContain("[connection-string]");
    expect(text).toContain("[data-url]");
  });

  it("keeps ordinary error text readable", () => {
    expect(scrubText("TypeError: Cannot read properties of undefined (reading 'name')")).toBe(
      "TypeError: Cannot read properties of undefined (reading 'name')",
    );
    expect(scrubText("code: empty_reply")).toBe("code: empty_reply");
  });

  it("caps length", () => {
    expect(scrubText("x".repeat(5000), 100).length).toBe(100);
  });

  it("drops sensitive keys from objects and scrubs nested strings", () => {
    const out = scrubValue({
      token: "abc",
      headers: { Authorization: "Bearer zzz", accept: "json" },
      list: [{ cookie: "a=b" }, `see ${JWT}`],
    }) as { token?: unknown; headers: Record<string, unknown>; list: [Record<string, unknown>, string] };
    expect(out.token).toBeUndefined();
    expect(out.headers.Authorization).toBeUndefined();
    expect(out.headers.accept).toBe("json");
    expect(out.list[0].cookie).toBeUndefined();
    expect(out.list[1]).not.toContain(JWT);
    expect(isSensitiveKey("refresh_token")).toBe(true);
    expect(isSensitiveKey("status")).toBe(false);
  });

  it("keeps only the path and redacts sensitive query values in URLs", () => {
    expect(scrubUrlPath("https://anima-protocol.com/chat/abc?token=xyz&tab=2#frag")).toBe(
      "/chat/abc?token=[redacted]&tab=…",
    );
  });
});

describe("bug squasher fingerprints", () => {
  it("normalises volatile parts of messages", () => {
    expect(normalizeMessage("Failed to load 42 items for 3f2a9c1d8e7b at https://x.y/z")).toBe(
      "Failed to load <n> items for <hex> at <url>",
    );
    expect(normalizeMessage('Unknown character "Asami Sato"')).toBe("Unknown character <str>");
  });

  it("finds the top frame without bundle hashes or line numbers", () => {
    const v8 = "TypeError: x\n    at renderChat (https://a.com/assets/Chat-B1c2D3e4.js:10:20)\n    at x (y.js:1:1)";
    const gecko = "renderChat@https://a.com/assets/Chat-Zz9Yy8Xx.js:99:3";
    expect(topFrame(v8)).toBe("renderChat@Chat.js");
    expect(topFrame(gecko)).toBe("renderChat@Chat.js");
  });

  it("groups the same error across builds, line numbers and ids", () => {
    const a = bugFingerprint({
      kind: "window_error",
      message: "Cannot read properties of undefined (reading 'id') for user_abc123456",
      stack: "at load (https://a.com/assets/index-AAAA1111.js:1:2)",
    });
    const b = bugFingerprint({
      kind: "window_error",
      message: "Cannot read properties of undefined (reading 'id') for user_zzz999999",
      stack: "at load (https://a.com/assets/index-BBBB2222.js:300:9)",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^a_[0-9a-f]{32}$/);
  });

  it("separates different errors and different kinds", () => {
    const base = { message: "boom", stack: "at f (a.js:1:1)" };
    expect(bugFingerprint({ kind: "window_error", ...base })).not.toBe(
      bugFingerprint({ kind: "react_crash", ...base }),
    );
    expect(bugFingerprint({ kind: "window_error", ...base })).not.toBe(
      bugFingerprint({ kind: "window_error", message: "bang", stack: base.stack }),
    );
  });

  it("api errors group by method, id-free path and status", () => {
    expect(normalizeApiPath("/api/chat/sessions/123/messages?x=1")).toBe("/api/chat/sessions/:id/messages");
    const one = bugSignature({ kind: "api_error", api: { method: "post", path: "/api/store/ent_abcdef12", status: 502 } });
    const two = bugSignature({ kind: "api_error", api: { method: "POST", path: "/api/store/ent_zzzzzz99", status: 502 } });
    expect(one).toBe(two);
    expect(one).toBe("api|POST|/api/store/:id|502");
    expect(bugSignature({ kind: "api_error", api: { method: "GET", path: "/api/x", status: 0 } })).toBe(
      "api|GET|/api/x|network",
    );
  });

  it("chat failures group by failure type and phase", () => {
    expect(bugSignature({ kind: "chat_failure", chat: { failure_type: "post", phase: "post" } })).toBe(
      "chat|post|post",
    );
  });
});

describe("parseBugReport", () => {
  it("parses an automatic report, scrubs it and computes the fingerprint", () => {
    const parsed = parseBugReport({
      kind: "window_error",
      message: `TypeError: boom token=${"x".repeat(10)}`,
      stack: "at f (https://a.com/assets/index-ABCDEF12.js:1:1)",
      route: "/chat/sess_1?token=abc",
      app_version: "c9d2565a",
      context: { breadcrumbs: [{ type: "nav", message: "/chat" }], authorization: "Bearer x" },
      fingerprint: "a_attacker_controlled_value",
      user_id: "someone_else",
    });
    expect(parsed.kind).toBe("window_error");
    expect(parsed.message).not.toContain("xxxxxxxxxx");
    expect(parsed.route).toBe("/chat/sess_1?token=[redacted]");
    expect(parsed.fingerprint).toMatch(/^a_[0-9a-f]{32}$/);
    expect(parsed.fingerprint).not.toBe("a_attacker_controlled_value");
    expect(parsed.context.authorization).toBeUndefined();
    expect(parsed.appVersion).toBe("c9d2565a");
    expect(parsed.screenshot).toBeNull();
    expect(parsed.occurrences).toBe(1);
    expect(parsed).not.toHaveProperty("userId");
  });

  it("rejects unknown kinds, empty automatic reports and too-short manual reports", () => {
    expect(() => parseBugReport({ kind: "nope", message: "x" })).toThrow(BugReportInputError);
    expect(() => parseBugReport({ kind: "window_error" })).toThrow(BugReportInputError);
    expect(() => parseBugReport({ kind: "manual", description: "x" })).toThrow(BugReportInputError);
    expect(() => parseBugReport(null)).toThrow(BugReportInputError);
  });

  it("titles api and chat reports from their context", () => {
    const api = parseBugReport({ kind: "api_error", context: { api: { method: "post", path: "/api/chat/messages", status: 502 } } });
    expect(api.title).toBe("POST /api/chat/messages → 502");
    const chat = parseBugReport({ kind: "chat_failure", message: "empty", context: { chat: { failure_type: "post", phase: "post" } } });
    expect(chat.title).toBe("Chat turn failed: post (post)");
  });

  it("clamps occurrences", () => {
    expect(parseBugReport({ kind: "window_error", message: "x", occurrences: 9999 }).occurrences).toBe(50);
    expect(parseBugReport({ kind: "window_error", message: "x", occurrences: -3 }).occurrences).toBe(1);
  });

  it("keeps a manual screenshot only when it is a bounded image data URL", () => {
    const ok = `data:image/jpeg;base64,${"A".repeat(100)}`;
    expect(parseBugReport({ kind: "manual", description: "the send button froze", screenshot: ok }).screenshot).toBe(ok);
    expect(parseBugReport({ kind: "window_error", message: "x", screenshot: ok }).screenshot).toBeNull();
    expect(() => cleanScreenshot("data:text/html;base64,AAAA")).toThrow(BugReportInputError);
    expect(() => cleanScreenshot(`data:image/png;base64,${"A".repeat(800_000)}`)).toThrow(/too large/);
  });

  it("trims oversized context breadcrumbs instead of failing", () => {
    const crumbs = Array.from({ length: 30 }, (_, i) => ({ type: "api", message: `${i} ${"y ".repeat(240)}` }));
    const ctx = cleanContext({ breadcrumbs: crumbs, route: "/x" });
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(16_000);
    expect(ctx.route).toBe("/x");
  });

  it("validates status updates", () => {
    expect(parseStatusUpdate({ status: "fixed", note: "shipped in #781" })).toEqual({ status: "fixed", note: "shipped in #781" });
    expect(() => parseStatusUpdate({ status: "done" })).toThrow(BugReportInputError);
  });
});

describe("client/server fingerprint parity", () => {
  it("the browser computes the same signature as the server", async () => {
    // @ts-expect-error plain JS module from the frontend package
    const client = await import("../../anima-protocol/src/lib/bugSquasher/fingerprint.js");
    const cases = [
      { kind: "window_error", message: "TypeError: x of 42 at https://a.b/c", stack: "at f (https://a.com/assets/index-ABCDEF12.js:1:2)" },
      { kind: "react_crash", message: 'Unknown "Asami"', stack: "g@https://a.com/assets/Chat-Zz9Yy8Xx.js:9:1" },
      { kind: "api_error", api: { method: "post", path: "/api/store/ent_abcdef12?x=1", status: 503 } },
      { kind: "chat_failure", chat: { failure_type: "no_first_token", phase: "prefill" } },
      { kind: "manual", description: "Send button froze after 3 tries" },
    ];
    for (const c of cases) expect(client.bugSignature(c)).toBe(bugSignature(c));
  });
});
