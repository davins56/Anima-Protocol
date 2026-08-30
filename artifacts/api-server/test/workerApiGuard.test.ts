import { describe, expect, it, vi } from "vitest";
import {
  coerceApiResponseToJson,
  fetchApiThroughExpress,
  isLongLivedApiPath,
  isWorkerApiPath,
  jsonApiErrorResponse,
  looksLikeHtmlBody,
  shouldTimeoutApiPath,
  WorkerApiTimeoutError,
  withWorkerApiTimeout,
} from "../src/lib/workerApiGuard";

const CF_HTML = `<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->`;

describe("worker API path helpers", () => {
  it("identifies /api and /api/* only", () => {
    expect(isWorkerApiPath("/api")).toBe(true);
    expect(isWorkerApiPath("/api/store/Character")).toBe(true);
    expect(isWorkerApiPath("/characters")).toBe(false);
    expect(isWorkerApiPath("/assets/app.js")).toBe(false);
  });

  it("times out store and healthz but not chat or SSE", () => {
    expect(shouldTimeoutApiPath("/api/store/Character")).toBe(true);
    expect(shouldTimeoutApiPath("/api/healthz/db")).toBe(true);
    expect(shouldTimeoutApiPath("/api/store/events")).toBe(false);
    expect(shouldTimeoutApiPath("/api/chat")).toBe(false);
    expect(shouldTimeoutApiPath("/api/openai/invoke/x")).toBe(false);
    expect(isLongLivedApiPath("/api/store/events")).toBe(true);
  });
});

describe("jsonApiErrorResponse", () => {
  it("returns JSON 503 for a Hyperdrive-style throw", async () => {
    const err = Object.assign(new Error("write CONNECT_TIMEOUT"), {
      code: "CONNECT_TIMEOUT",
    });
    const response = jsonApiErrorResponse(err);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Database connection timed out",
      reason: "timeout",
      code: "CONNECT_TIMEOUT",
    });
    expect(JSON.stringify(body)).not.toMatch(/<!DOCTYPE|html/i);
  });

  it("returns JSON for an isolate throw that is not a DB error", async () => {
    const response = jsonApiErrorResponse(new Error("script exceeded memory"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/unavailable/i);
    expect(body.code).toBe("worker_api_failure");
    expect(JSON.stringify(body)).not.toMatch(/<!DOCTYPE/);
  });
});

describe("coerceApiResponseToJson", () => {
  it("replaces Cloudflare HTML 5xx with JSON 503", async () => {
    const html = new Response(CF_HTML, {
      status: 500,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
    const coerced = await coerceApiResponseToJson(html);
    expect(coerced.status).toBe(503);
    expect(coerced.headers.get("content-type")).toMatch(/application\/json/);
    const body = await coerced.json();
    expect(body.error).toMatch(/unavailable|database/i);
    expect(JSON.stringify(body)).not.toMatch(/lt IE 7|DOCTYPE/i);
  });

  it("passes JSON store errors through", async () => {
    const json = Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    const coerced = await coerceApiResponseToJson(json);
    expect(coerced.status).toBe(401);
    await expect(coerced.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("does not buffer SSE streams", async () => {
    const sse = new Response("data: ping\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const coerced = await coerceApiResponseToJson(sse);
    expect(coerced).toBe(sse);
  });

  it("detects Cloudflare IE-conditional HTML", () => {
    expect(looksLikeHtmlBody(CF_HTML)).toBe(true);
    expect(looksLikeHtmlBody('{"error":"Unauthorized"}')).toBe(false);
  });

  it("detects Cloudflare's own 301 body", () => {
    const cf301 = `<html><head><title>301 Moved Permanently</title></head><body><center><h1>301 Moved Permanently</h1></center><hr><center>cloudflare</center></body></html>`;
    expect(looksLikeHtmlBody(cf301)).toBe(true);
  });
});

describe("fetchApiThroughExpress", () => {
  it("turns an Uncaught Exception on /api/store into JSON 503", async () => {
    const handler = {
      fetch: async () => {
        throw new Error("Uncaught Exception");
      },
    };
    const response = await fetchApiThroughExpress(
      new Request("https://anima-protocol.com/api/store/Character"),
      {},
      {},
      handler,
    );
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/unreachable|unavailable|database/i);
    expect(JSON.stringify(body)).not.toMatch(/<!DOCTYPE|Uncaught Exception|lt IE 7/);
  });

  it("catches isolate throws and returns JSON instead of letting CF emit HTML", async () => {
    const handler = {
      fetch: async () => {
        throw new Error("The script will never generate a response");
      },
    };
    const response = await fetchApiThroughExpress(
      new Request("https://anima-protocol.com/api/store/Character"),
      {},
      {},
      handler,
    );
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toMatch(/<!DOCTYPE|lt IE 7/);
  });

  it("coerces Express HTML 404 on /api to JSON", async () => {
    const handler = {
      fetch: async () =>
        new Response("<!DOCTYPE html><html><body>Cannot GET /api/nope</body></html>", {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    };
    const response = await fetchApiThroughExpress(
      new Request("https://anima-protocol.com/api/nope"),
      {},
      {},
      handler,
    );
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/Cannot GET/);
  });

  it("times out a hung store fetch as JSON 503", async () => {
    const handler = {
      fetch: () => new Promise<Response>(() => {}),
    };
    const response = await fetchApiThroughExpress(
      new Request("https://anima-protocol.com/api/store/Character"),
      {},
      {},
      handler,
      { timeoutMs: 20 },
    );
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(["timeout", "ETIMEOUT"]).toContain(body.code);
    expect(body.error).toMatch(/unavailable|timeout|database/i);
    expect(JSON.stringify(body)).not.toMatch(/<!DOCTYPE|lt IE 7/);
  });
});

describe("withWorkerApiTimeout", () => {
  it("resolves when the handler finishes first", async () => {
    const value = await withWorkerApiTimeout(Promise.resolve("ok"), 50);
    expect(value).toBe("ok");
  });

  it("rejects with WorkerApiTimeoutError", async () => {
    vi.useFakeTimers();
    try {
      const pending = withWorkerApiTimeout(new Promise(() => {}), 25);
      const expectation = expect(pending).rejects.toBeInstanceOf(
        WorkerApiTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(25);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
