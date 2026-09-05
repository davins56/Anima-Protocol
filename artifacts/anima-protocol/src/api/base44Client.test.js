import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base44,
  clearAuthTokenGetter,
  clearStoreCache,
  setAuthTokenGetter,
  STORE_FETCH_TIMEOUT_MS,
  STORE_LIST_RETRY_LIMIT,
  STORE_SESSION_CREATE_TIMEOUT_MS,
} from "./base44Client";
import {
  isStoreDatabaseError,
  isStoreReadUnavailable,
} from "@/lib/loadRosterCharacters";

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
        messages_migrated: true,
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
    expect(timeoutSpy).toHaveBeenCalledTimes(STORE_LIST_RETRY_LIMIT + 1);
    expect(global.fetch).toHaveBeenCalledTimes(STORE_LIST_RETRY_LIMIT + 1);
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
    expect(STORE_LIST_RETRY_LIMIT).toBe(1);
  });

  it("retries a list GET after a client timeout and succeeds", async () => {
    clearStoreCache();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      return new AbortController().signal;
    });
    let listGets = 0;
    global.fetch = vi.fn(async () => {
      listGets += 1;
      if (listGets === 1) {
        throw Object.assign(new Error("The operation was aborted"), {
          name: "TimeoutError",
        });
      }
      return Response.json([{ id: "check-1", note: "warm" }]);
    });

    await expect(base44.entities.CheckIn.list()).resolves.toEqual([
      { id: "check-1", note: "warm" },
    ]);
    expect(listGets).toBe(2);
  });

  it("does not retry a write after a client timeout", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      return new AbortController().signal;
    });
    let creates = 0;
    global.fetch = vi.fn(async () => {
      creates += 1;
      throw abortErr;
    });

    await expect(base44.entities.CheckIn.create({ note: "x" })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(creates).toBe(1);
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

  it("does not POST nested messages or call replace for an empty Init payload", async () => {
    const sessionWrites = [];
    const messageWrites = [];
    global.fetch = vi.fn(async (url, options = {}) => {
      const { pathname } = new URL(String(url), "http://localhost");
      const body = options.body ? JSON.parse(String(options.body)) : {};
      if (pathname === "/api/store/ChatSession") {
        sessionWrites.push(body);
        return Response.json({ id: "session-solo", title: body.title }, { status: 201 });
      }
      if (pathname === "/api/store/messages/replace") {
        messageWrites.push(body);
        return Response.json([]);
      }
      return Response.json({});
    });

    const session = await base44.entities.ChatSession.create({
      mode: "solo",
      character_id: "char-1",
      title: "T'Challa",
      opening_scene: "A quiet room.",
      messages: [],
    });

    expect(sessionWrites).toEqual([
      {
        mode: "solo",
        character_id: "char-1",
        title: "T'Challa",
        opening_scene: "A quiet room.",
        messages_migrated: true,
      },
    ]);
    expect(sessionWrites[0]).not.toHaveProperty("messages");
    expect(messageWrites).toEqual([]);
    expect(session).toEqual({
      id: "session-solo",
      title: "T'Challa",
      messages: [],
    });
  });

  it("uses the documented Init create budget and surfaces abort as a timeout", async () => {
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
        throw options.signal.reason || abortErr;
      }
      return Response.json({ id: "never" });
    });

    await expect(
      base44.entities.ChatSession.create({ title: "Init Session" }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(timeoutSpy).toHaveBeenCalledWith(STORE_SESSION_CREATE_TIMEOUT_MS);
    expect(STORE_SESSION_CREATE_TIMEOUT_MS).toBe(20000);
  });

  it("mints a fresh create budget when retrying a 503 connection reset", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      controller.signal.budgetMs = ms;
      return controller.signal;
    });
    let sessionPosts = 0;
    const signals = [];
    global.fetch = vi.fn(async (url, options = {}) => {
      const { pathname } = new URL(String(url), "http://localhost");
      if (pathname === "/api/store/ChatSession") {
        sessionPosts += 1;
        signals.push(options.signal);
        if (sessionPosts === 1) {
          return Response.json(
            { error: "Database connection reset", reason: "reset", code: "ECONNRESET" },
            { status: 503 },
          );
        }
        return Response.json({ id: "session-fresh", title: "Recovered" }, { status: 201 });
      }
      return Response.json({});
    });

    const session = await base44.entities.ChatSession.create({ title: "Recovered" });

    expect(session.id).toBe("session-fresh");
    expect(sessionPosts).toBe(2);
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, STORE_SESSION_CREATE_TIMEOUT_MS);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, STORE_SESSION_CREATE_TIMEOUT_MS);
    expect(signals[0]).not.toBe(signals[1]);
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
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

  it("throws a clean store error instead of Cloudflare HTML, and does not blame the database", async () => {
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
    // The upstream status is preserved now that classification no longer
    // depends on it being rewritten to 503.
    expect(caught).toMatchObject({
      status: 500,
      transport: true,
      message: expect.stringMatching(/unreachable/i),
    });
    expect(String(caught.message)).not.toMatch(/DOCTYPE|lt IE 7|no-js ie6/i);
    // A Cloudflare error page tells us nothing about Postgres, so the UI must
    // not report a database outage...
    expect(isStoreDatabaseError(caught)).toBe(false);
    expect(String(caught.message)).not.toMatch(/database/i);
    // ...but the roster is still unreadable, so the bundled fallback applies.
    expect(isStoreReadUnavailable(caught)).toBe(true);
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

describe("auth.updateMe profile persist", () => {
  beforeEach(() => {
    setAuthTokenGetter(() => "test-token");
    clearStoreCache();
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("throws after a Hyperdrive reset so Settings can show the error", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      const { pathname } = new URL(String(url), "http://localhost");
      if (pathname === "/api/store/profile" && options.method === "PUT") {
        return Response.json(
          { error: "Database connection reset", reason: "reset", code: "ECONNRESET" },
          { status: 503 },
        );
      }
      if (pathname === "/api/store/profile") {
        return Response.json({ display_name: "Ada", settings: {} });
      }
      return Response.json({});
    });

    await expect(
      base44.auth.updateMe({
        settings: { chat_bg_image: "/api/storage/objects/uploads/bg" },
      }),
    ).rejects.toMatchObject({
      status: 503,
      reason: "reset",
      message: "Database connection reset",
    });
  });
});
