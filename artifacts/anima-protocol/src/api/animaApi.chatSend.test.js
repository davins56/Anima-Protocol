import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatAuthRequiredError, chatHttpError } from "./animaApi.js";

const authHeaders = vi.fn();
const fetchMock = vi.fn();

vi.mock("./authBridge", () => ({
  authHeaders: (...args) => authHeaders(...args),
}));

vi.mock("@/lib/apiOrigin", () => ({
  apiUrl: (path) => `https://example.test/api${path}`,
}));

describe("chat send auth and HTTP errors", () => {
  beforeEach(() => {
    authHeaders.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps 401 and Unauthorized copy to a sign-in hint", () => {
    expect(chatHttpError({ error: "Unauthorized" }, 401).message).toMatch(
      /Not signed in/,
    );
    expect(chatAuthRequiredError().status).toBe(401);
  });

  it("maps a missing session to a start-again hint", () => {
    expect(chatHttpError({ error: "Session not found" }, 404).message).toMatch(
      /start the session again/i,
    );
  });

  it("keeps Workers AI / DeepSeek errors intact", () => {
    expect(
      chatHttpError({ error: "DeepSeek on Workers AI failed: rate limited" }, 502)
        .message,
    ).toMatch(/DeepSeek on Workers AI failed: rate limited/);
  });

  it("attaches Authorization before POST /chat/messages and retries a 401", async () => {
    authHeaders
      .mockResolvedValueOnce({
        "Content-Type": "application/json",
        Authorization: "Bearer stale",
      })
      .mockResolvedValueOnce({
        "Content-Type": "application/json",
        Authorization: "Bearer fresh",
      });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"content":"Hi"}\n\n'));
        controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
        controller.close();
      },
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body,
      });

    const { animaApi } = await import("./animaApi.js");
    const events = [];
    for await (const event of animaApi.chat.sendMessage({
      sessionId: "sess-1",
      content: "hello",
    })) {
      events.push(event);
    }

    expect(authHeaders).toHaveBeenCalledTimes(2);
    expect(authHeaders.mock.calls[1][1]).toMatchObject({ skipCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/chat/messages");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer stale");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh");
    expect(events.some((event) => event.content === "Hi")).toBe(true);
    expect(events.some((event) => event.done)).toBe(true);
  });

  it("refuses to POST /chat/messages without a Bearer token", async () => {
    authHeaders.mockResolvedValue({ "Content-Type": "application/json" });
    const { animaApi } = await import("./animaApi.js");
    await expect(
      animaApi.chat.sendMessage({ sessionId: "sess-1", content: "hello" }).next(),
    ).rejects.toThrow(/Not signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
