import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import notificationsRouter from "../src/routes/notifications";
import {
  db,
  proactiveMessagePreferences,
  pushSubscriptions,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const userId = `notifications_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.CRON_SECRET = "test-cron-secret";
  const app: Express = express();
  app.use(express.json());
  app.use("/notifications", notificationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  await db
    .delete(proactiveMessagePreferences)
    .where(eq(proactiveMessagePreferences.userId, userId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}/notifications${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("notification preferences route", () => {
  it("reports push configuration and disabled defaults", async () => {
    const response = await call("GET", "/preferences");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      vapid_public_key: "test-public-key",
      enabled: false,
      frequency_hours: 24,
      subscribed: false,
    });
  });

  it("requires a valid browser subscription before enabling messages", async () => {
    const noSubscription = await call("PUT", "/preferences", {
      enabled: true,
      frequency_hours: 24,
    });
    expect(noSubscription.status).toBe(409);

    const invalid = await call("POST", "/subscriptions", {
      endpoint: "not-a-url",
      keys: {},
    });
    expect(invalid.status).toBe(400);

    const subscribed = await call("POST", "/subscriptions", {
      endpoint: `https://push.example.test/${userId}`,
      keys: { p256dh: "p256dh-test-key", auth: "auth-test-key" },
    });
    expect(subscribed.status).toBe(201);

    const enabled = await call("PUT", "/preferences", {
      enabled: true,
      frequency_hours: 72,
    });
    expect(enabled.status).toBe(200);
    const payload = (await enabled.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({ enabled: true, frequency_hours: 72 });
    expect(payload.next_message_at).toEqual(expect.any(String));

    const [stored] = await db
      .select()
      .from(proactiveMessagePreferences)
      .where(eq(proactiveMessagePreferences.userId, userId));
    expect(stored?.enabled).toBe(true);
    expect(stored?.frequencyHours).toBe(72);
  });

  it("disables outreach when the device subscription is removed", async () => {
    const response = await call("DELETE", "/subscriptions", {
      endpoint: `https://push.example.test/${userId}`,
    });
    expect(response.status).toBe(200);

    const [stored] = await db
      .select()
      .from(proactiveMessagePreferences)
      .where(eq(proactiveMessagePreferences.userId, userId));
    expect(stored?.enabled).toBe(false);
    expect(stored?.nextMessageAt).toBeNull();
  });

  it("rejects cron calls without the shared secret", async () => {
    const response = await call("GET", "/proactive/run");
    expect(response.status).toBe(401);
  });
});
