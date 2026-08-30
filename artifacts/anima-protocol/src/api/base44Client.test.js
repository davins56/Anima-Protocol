import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base44,
  clearAuthTokenGetter,
  clearStoreCache,
  setAuthTokenGetter,
  STORE_FETCH_TIMEOUT_MS,
} from "./base44Client";
import { isStoreDatabaseError } from "@/lib/loadRosterCharacters";

describe("ChatSession store wrapper", () => {
  beforeEach(() => {
    setAuthTokenGetter(() => "test-token");
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("stores initial messages via the message replacement endpoint", async () => {
    const sessionWrites = [];
    const messageWrites = [];
    const savedMessages = [
      {
        id: "msg-1",
        role: "assistant",
        content: "The scene begins.",
        seq: 1,
      },
    ];

    global.fetch = vi.fn(async (url, options = {}) => {
      const { pathname } = new URL(String(url), "http://localhost");
      const body = options.body ? JSON.parse(String(options.body)) : {};

      if (pathname === "/api/store/ChatSession") {
        sessionWrites.push(body);
        return Response.json({ id: "session-1", title: body.title });
      }

      if (pathname === "/api/store/messages/replace") {
        messageWrites.push(body);
        return Response.json(savedMessages);
      }

      return Response.json({});
    });

    const session = await base44.entities.ChatSession.create({
      title: "Init Session",
      opening_scene: "A neon room hums.",
      messages: [{ role: "assistant", content: "The scene begins." }],
    });

    expect(sessionWrites).toEqual([
      {
        title: "Init Session",
        opening_scene: "A neon room hums.",
      },
    ]);
    expect(messageWrites).toEqual([
      {
        session_id: "session-1",
        messages: [{ role: "assistant", content: "The scene begins." }],
      },
    ]);
    expect(session).toEqual({
      id: "session-1",
      title: "Init Session",
      messages: savedMessages,
    });
  });

  it("fails fast when the store fetch timeout signal aborts", async () => {
    clearStoreCache();
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controller.abort(abortErr);
      return controller.signal;
    });

    global.fetch = vi.fn(async (_url, options = {}) => {
      if (options.signal?.aborted) {
        const reason = options.signal.reason || abortErr;
        throw reason;
      }
      return Response.json([]);
    });

    await expect(base44.entities.CheckIn.list()).rejects.toMatchObject({
      code: "timeout",
    });
    expect(timeoutSpy).toHaveBeenCalledWith(STORE_FETCH_TIMEOUT_MS);
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
  });

  it("retries ChatSession.create after a database connection reset", async () => {
    let sessionPosts = 0;
    global.fetch = vi.fn(async (url, options = {}) => {
      const { pathname } = new URL(String(url), "http://localhost");
      if (pathname === "/api/store/ChatSession") {
        sessionPosts += 1;
        if (sessionPosts === 1) {
          return Response.json(
            { error: "Database connection reset", reason: "reset", code: "ECONNRESET" },
            { status: 503 },
          );
        }
        const body = options.body ? JSON.parse(String(options.body)) : {};
        return Response.json({ id: "session-2", title: body.title }, { status: 201 });
      }
      if (pathname === "/api/store/messages/replace") {
        return Response.json([]);
      }
      return Response.json({});
    });

    const session = await base44.entities.ChatSession.create({
      title: "Recovered session",
    });

    expect(sessionPosts).toBe(2);
    expect(session).toEqual({
      id: "session-2",
      title: "Recovered session",
    });
  });

  it("does not retry ChatSession.create on a non-reset store error", async () => {
    let sessionPosts = 0;
    global.fetch = vi.fn(async (url) => {
      const { pathname } = new URL(String(url), "http://localhost");
      if (pathname === "/api/store/ChatSession") {
        sessionPosts += 1;
        return Response.json(
          {
            error: "Database schema is missing or out of date",
            reason: "schema",
          },
          { status: 503 },
        );
      }
      return Response.json({});
    });

    await expect(
      base44.entities.ChatSession.create({ title: "Blocked" }),
    ).rejects.toThrow(/schema is missing/i);
    expect(sessionPosts).toBe(1);
  });
});

describe("parseStoreErrorResponse", () => {
  it("never dumps Cloudflare HTML into the error message", async () => {
    const { parseStoreErrorResponse, STORE_UNREACHABLE_MESSAGE } =
      await import("./base44Client");
    const html = `<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->`;
    const message = await parseStoreErrorResponse(
      new Response(html, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(message).toBe(STORE_UNREACHABLE_MESSAGE);
    expect(message).not.toMatch(/DOCTYPE|lt IE 7|no-js ie6/i);
  });

  it("keeps JSON store errors", async () => {
    const { parseStoreErrorResponse } = await import("./base44Client");
    const message = await parseStoreErrorResponse(
      Response.json(
        { error: "Database connection reset", reason: "reset" },
        { status: 503 },
      ),
    );
    expect(message).toBe("Database connection reset");
  });

  it("never dumps Cloudflare's www 301 HTML (<center>cloudflare</center>)", async () => {
    const { parseStoreErrorResponse, STORE_UNREACHABLE_MESSAGE } =
      await import("./base44Client");
    const html = `<html>
<head><title>301 Moved Permanently</title></head>
<body>
<center><h1>301 Moved Permanently</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`;
    const message = await parseStoreErrorResponse(
      new Response(html, {
        status: 301,
        headers: {
          "Content-Type": "text/html",
          Location: "https://anima-protocol.com/",
        },
      }),
    );
    expect(message).toBe(STORE_UNREACHABLE_MESSAGE);
    expect(message).not.toMatch(/cloudflare|Moved Permanently|DOCTYPE/i);
  });

  it("explains a plain 404 without treating it as HTML", async () => {
    const { parseStoreErrorResponse } = await import("./base44Client");
    const message = await parseStoreErrorResponse(
      new Response("Cannot GET /api/store/Character", { status: 404 }),
    );
    expect(message).toMatch(/not found|not proxied/i);
    expect(message).not.toMatch(/Cannot GET|DOCTYPE/i);
  });
});

describe("Character.list HTML failures", () => {
  beforeEach(() => {
    setAuthTokenGetter(() => "test-token");
    clearStoreCache();
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("throws a 503 store/database error instead of Cloudflare HTML", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        `<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US">`,
        {
          status: 500,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );

    let caught;
    try {
      await base44.entities.Character.list("-created_date", 100, {
        _bootstrapInternal: true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({
      status: 503,
      message: expect.stringMatching(/unreachable|database/i),
    });
    expect(String(caught.message)).not.toMatch(/DOCTYPE|lt IE 7|no-js ie6/i);
    expect(isStoreDatabaseError(caught)).toBe(true);
  });

  it("treats a 200 homepage HTML body (www path-dropped redirect) as a store error", async () => {
    global.fetch = vi.fn(async () =>
      new Response(`<!doctype html><html lang="en"><title>Anima Protocol</title>`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(
      base44.entities.CheckIn.list(),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/unreachable|database/i),
    });
  });
});
