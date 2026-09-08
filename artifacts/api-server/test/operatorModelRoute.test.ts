import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import operatorModelRouter from "../src/routes/operatorModel";
import { db, userProfiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { emptyOperatorModel } from "../src/lib/operatorModel";

const userId = `operator_model_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/operator-model", operatorModelRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, body?: unknown, authed = true) {
  return fetch(`${baseUrl}/operator-model`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authed ? { "x-test-user": userId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("operator-model route", () => {
  it("requires a Clerk session", async () => {
    const response = await call("GET", undefined, false);
    expect(response.status).toBe(401);
  });

  it("returns empty sections on first GET without writing junk", async () => {
    const response = await call("GET");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.model).toEqual(emptyOperatorModel());
    expect(json.updated_at).toBeNull();
  });

  it("PUT persists a normalized model and GET reads it back", async () => {
    const put = await call("PUT", {
      identity: {
        name: "Dàvīn",
        communication_style: "direct, mythic",
        secret: "drop",
      },
      cognitive: { projects: ["Anima Protocol"] },
    });
    expect(put.status).toBe(200);
    const saved = await put.json();
    expect(saved.model.identity.name).toBe("Dàvīn");
    expect(saved.model.identity).not.toHaveProperty("secret");
    expect(saved.updated_at).toBeTruthy();

    const get = await call("GET");
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      model: {
        identity: {
          name: "Dàvīn",
          communication_style: "direct, mythic",
        },
        cognitive: { projects: ["Anima Protocol"] },
      },
    });
  });

  it("PATCH merges sections without wiping the rest", async () => {
    const patch = await call("PATCH", {
      model: {
        relational: { important_people: ["Serenity"] },
        identity: { preferences: ["quiet mornings"] },
      },
    });
    expect(patch.status).toBe(200);
    const json = await patch.json();
    expect(json.model.identity.name).toBe("Dàvīn");
    expect(json.model.identity.preferences).toEqual(["quiet mornings"]);
    expect(json.model.cognitive.projects).toEqual(["Anima Protocol"]);
    expect(json.model.relational.important_people).toEqual(["Serenity"]);
  });

  it("rejects a non-object PUT", async () => {
    const response = await call("PUT", ["not", "an", "object"]);
    expect(response.status).toBe(400);
  });
});
