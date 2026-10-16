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
import { db, uploadedImages, userEntities } from "@workspace/db";
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

  it("rejects a gif and a jpeg whose bytes are not a jpeg", async () => {
    const gif = await postUpload(user("owner"), {
      contentType: "image/gif",
      dataBase64: Buffer.from("GIF89a").toString("base64"),
    });
    expect(gif.status).toBe(400);
    expect(gif.json.error).toMatch(/JPEG, PNG, WebP, or HEIC/i);

    const mismatch = await postUpload(user("owner"), {
      contentType: "image/jpeg",
      dataBase64: TINY_PNG,
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json.error).toMatch(/doesn't look like/i);
  });

  it("stores a heic photo when the file header matches", async () => {
    const heic = Buffer.alloc(16);
    heic.writeUInt32BE(16, 0);
    heic.write("ftyp", 4, "ascii");
    heic.write("heic", 8, "ascii");
    const { status, json } = await postUpload(user("owner"), {
      contentType: "image/heic",
      dataBase64: heic.toString("base64"),
    });
    expect(status).toBe(201);
    expect(json.contentType).toBe("image/heic");
    const id = String(json.objectPath).split("/").pop();
    const getRes = await fetch(`${baseUrl}/storage/objects/uploads/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toMatch(/image\/heic/);
  });

  it("rejects an heic label whose brand is avif", async () => {
    const avif = Buffer.alloc(16);
    avif.writeUInt32BE(16, 0);
    avif.write("ftyp", 4, "ascii");
    avif.write("avif", 8, "ascii");
    const { status, json } = await postUpload(user("owner"), {
      contentType: "image/heic",
      dataBase64: avif.toString("base64"),
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/doesn't look like/i);
  });

  it("deletes an upload for the owner and hides it from everyone else", async () => {
    const owner = user("owner");
    const other = user("other");
    const { status, json } = await postUpload(owner, {
      contentType: "image/png",
      dataBase64: TINY_PNG,
    });
    expect(status).toBe(201);
    const id = String(json.objectPath).split("/").pop();
    const stolen = await fetch(`${baseUrl}/storage/uploads/${id}`, {
      method: "DELETE",
      headers: { "x-test-user": other },
    });
    expect(stolen.status).toBe(404);
    const stillThere = await fetch(`${baseUrl}/storage/objects/uploads/${id}`);
    expect(stillThere.status).toBe(200);

    const removed = await fetch(`${baseUrl}/storage/uploads/${id}`, {
      method: "DELETE",
      headers: { "x-test-user": owner },
    });
    expect(removed.status).toBe(204);
    const gone = await fetch(`${baseUrl}/storage/objects/uploads/${id}`);
    expect(gone.status).toBe(404);
  });

  it("keeps a photo that a saved message still uses", async () => {
    const owner = user("owner");
    const { status, json } = await postUpload(owner, {
      contentType: "image/png",
      dataBase64: TINY_PNG,
    });
    expect(status).toBe(201);
    const id = String(json.objectPath).split("/").pop();
    await db.insert(userEntities).values({
      userId: owner,
      entityName: "ChatMessage",
      entityId: `${owner}-msg`,
      data: { attachments: [{ type: "image", url: `/api/storage/objects/uploads/${id}` }] },
    });
    const blocked = await fetch(`${baseUrl}/storage/uploads/${id}`, {
      method: "DELETE",
      headers: { "x-test-user": owner },
    });
    expect(blocked.status).toBe(409);
    const stillThere = await fetch(`${baseUrl}/storage/objects/uploads/${id}`);
    expect(stillThere.status).toBe(200);
    await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  });

  it("returns 413 for an oversized image payload", async () => {
    const tooBig = "A".repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3) + 16);
    const { status, json } = await postUpload(user("owner"), {
      contentType: "image/jpeg",
      dataBase64: tooBig,
    });
    expect(status).toBe(413);
    expect(json.error).toMatch(/too large/i);
  });
});
