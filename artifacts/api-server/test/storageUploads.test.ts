import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import storageRouter from "../src/routes/storage";
import { db, uploadedImages } from "@workspace/db";
import { like } from "drizzle-orm";

const PREFIX = `itest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "16mb" }));
  app.use(storageRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(uploadedImages).where(like(uploadedImages.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function postUpload(userId: string | null, body: unknown) {
  const res = await fetch(`${baseUrl}/storage/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

describe("POST /storage/uploads + GET /storage/objects/uploads/:id", () => {
  it("exposes an unauthenticated probe so a missing Worker route is distinguishable from 401", async () => {
    const res = await fetch(`${baseUrl}/storage/uploads`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; methods?: string[] };
    expect(json.ok).toBe(true);
    expect(json.methods).toContain("POST");
  });

  it("rejects unauthenticated uploads", async () => {
    const { status, json } = await postUpload(null, {
      contentType: "image/png",
      dataBase64: TINY_PNG,
    });
    expect(status).toBe(401);
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("stores an image and serves it on the explicit Worker/client path", async () => {
    const { status, json } = await postUpload(user("owner"), {
      contentType: "image/png",
      dataBase64: TINY_PNG,
    });
    expect(status).toBe(201);
    expect(json.file_url).toMatch(/^\/api\/storage\/objects\/uploads\//);
    expect(json.objectPath).toMatch(/^\/objects\/uploads\//);

    const id = String(json.objectPath).split("/").pop();
    const getRes = await fetch(`${baseUrl}/storage/objects/uploads/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toMatch(/image\/png/);
    const bytes = Buffer.from(await getRes.arrayBuffer());
    expect(bytes.equals(Buffer.from(TINY_PNG, "base64"))).toBe(true);
  });

  it("returns a real error for non-image payloads", async () => {
    const { status, json } = await postUpload(user("owner"), {
      contentType: "application/pdf",
      dataBase64: "QQ==",
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/only image/i);
  });
});
