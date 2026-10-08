import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import chatClientFailureRouter from "../src/routes/chatClientFailure";
import { logger } from "../src/lib/logger";
import { resetChatClientFailureReportsForTests } from "../src/lib/chatClientFailureReport";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit";

const SECRET_REPLY = "SECRET_REPLY_she_said_the_quiet_part";
const SECRET_USER = "SECRET_USER_what_he_typed_on_the_phone";
const SECRET_MEMORY = "SECRET_MEMORY_the_thing_she_remembers";

let server: Server;
let baseUrl = "";

function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    failure_type: "network_lost",
    phase: "prefill",
    session_id: "sess_1",
    turn_id: "turn_019",
    ms_to_failure: 812,
    ms_to_first_token: null,
    partial_kept: false,
    app_version: "f456e814",
    user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    ...overrides,
  };
}

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/chat/client-failure", chatClientFailureRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  resetChatClientFailureReportsForTests();
  resetRateLimitStateForTests();
  vi.restoreAllMocks();
});

describe("POST /chat/client-failure", () => {
  it("rejects a signed-out caller and does not log", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const response = await fetch(`${baseUrl}/chat/client-failure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportBody({ content: SECRET_REPLY })),
    });
    expect(response.status).toBe(401);
    expect(info).not.toHaveBeenCalled();
  });

  it("rejects an unknown failure type", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const response = await fetch(`${baseUrl}/chat/client-failure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user_123",
      },
      body: JSON.stringify(reportBody({ failure_type: "mystery" })),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid chat failure report",
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("logs one structured line and drops personal content", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const response = await fetch(`${baseUrl}/chat/client-failure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user_123",
      },
      body: JSON.stringify(
        reportBody({
          content: SECRET_USER,
          message: SECRET_USER,
          reply: SECRET_REPLY,
          memory: SECRET_MEMORY,
          partialContent: SECRET_REPLY,
          messages: [{ role: "user", content: SECRET_USER }],
        }),
      ),
    });
    expect(response.status).toBe(204);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      {
        event: "chat_client_failure",
        failure_type: "network_lost",
        phase: "prefill",
        failure_phase: "prefill",
        turn_id: "turn_019",
        session_id: "sess_1",
        ms_to_failure: 812,
        ms_to_first_token: null,
        partial_kept: false,
        app_version: "f456e814",
        user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        user_id: "user_123",
      },
      "chat_client_failure",
    );
    const logged = JSON.stringify(info.mock.calls[0]);
    expect(logged).not.toContain(SECRET_REPLY);
    expect(logged).not.toContain(SECRET_USER);
    expect(logged).not.toContain(SECRET_MEMORY);
    expect(logged).toContain("chat_client_failure");
    expect(logged).toContain("turn_019");
  });

  it("logs a duplicate turn once", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const send = () =>
      fetch(`${baseUrl}/chat/client-failure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user": "user_123",
        },
        body: JSON.stringify(reportBody()),
      });
    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(204);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("rate-limits a burst of distinct turns", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    for (let i = 0; i < 20; i += 1) {
      const response = await fetch(`${baseUrl}/chat/client-failure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user": "user_burst",
        },
        body: JSON.stringify(reportBody({ turn_id: `turn_${i}` })),
      });
      expect(response.status).toBe(204);
    }
    const blocked = await fetch(`${baseUrl}/chat/client-failure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user_burst",
      },
      body: JSON.stringify(reportBody({ turn_id: "turn_overflow" })),
    });
    expect(blocked.status).toBe(429);
    expect(info).toHaveBeenCalledTimes(20);
  });
});
