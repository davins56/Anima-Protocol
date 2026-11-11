import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CHAT_SESSION, db, userEntities, userProfiles } from "@workspace/db";
import { like } from "drizzle-orm";

const cleanupError = new Error("pdf cleanup exploded");

const cleanup = vi.hoisted(() => ({
  deleteLorePdfsForCharacter: vi.fn(async () => {
    throw cleanupError;
  }),
  deleteChatPdfsForSession: vi.fn(async () => {
    throw cleanupError;
  }),
  deleteAllPdfDocumentsForUser: vi.fn(async () => {
    throw cleanupError;
  }),
}));

vi.mock("../src/lib/pdf/store", () => cleanup);

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import storeRouter from "../src/routes/store";
import { logger } from "../src/lib/logger";

const PREFIX = `pdfclean_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";
const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/store", storeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  errorSpy.mockRestore();
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await db.delete(userProfiles).where(like(userProfiles.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(
  userId: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${baseUrl}/store${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

function loggedAction(action: string): boolean {
  return errorSpy.mock.calls.some((call) => {
    const fields = call[0] as { action?: string; err?: unknown } | undefined;
    return fields?.action === action && fields.err === cleanupError;
  });
}

describe("PDF cleanup never blocks delete or restore", () => {
  it("deletes a companion when lore PDF cleanup throws", async () => {
    const owner = user("companion");
    errorSpy.mockClear();
    cleanup.deleteLorePdfsForCharacter.mockClear();

    const created = await call(owner, "PUT", "/Character/hero", {
      id: "hero",
      name: "Hero",
    });
    expect(created.status).toBe(200);

    const deleted = await call(owner, "DELETE", "/Character/hero");
    expect(deleted.status).toBe(204);
    expect(cleanup.deleteLorePdfsForCharacter).toHaveBeenCalledWith(owner, "hero");
    expect(loggedAction("companion_delete")).toBe(true);

    const gone = await call(owner, "GET", "/Character/hero");
    expect(gone.status).toBe(200);
    expect(gone.json).toBeNull();
  });

  it("deletes an Anima when lore PDF cleanup throws", async () => {
    const owner = user("anima");
    errorSpy.mockClear();
    cleanup.deleteLorePdfsForCharacter.mockClear();

    await call(owner, "PUT", "/Anima/spirit", { id: "spirit", name: "Spirit" });
    const deleted = await call(owner, "DELETE", "/Anima/spirit");
    expect(deleted.status).toBe(204);
    expect(cleanup.deleteLorePdfsForCharacter).toHaveBeenCalledWith(owner, "spirit");
    expect(loggedAction("companion_delete")).toBe(true);

    const gone = await call(owner, "GET", "/Anima/spirit");
    expect(gone.json).toBeNull();
  });

  it("deletes a chat session when chat PDF cleanup throws", async () => {
    const owner = user("chat");
    errorSpy.mockClear();
    cleanup.deleteChatPdfsForSession.mockClear();

    await call(owner, "PUT", `/${CHAT_SESSION}/sess_1`, {
      id: "sess_1",
      title: "Notes",
    });
    const deleted = await call(owner, "DELETE", `/${CHAT_SESSION}/sess_1`);
    expect(deleted.status).toBe(204);
    expect(cleanup.deleteChatPdfsForSession).toHaveBeenCalledWith(owner, "sess_1");
    expect(loggedAction("chat_session_delete")).toBe(true);

    const gone = await call(owner, "GET", `/${CHAT_SESSION}/sess_1`);
    expect(gone.json).toBeNull();
  });

  it("finishes a replace restore when wiping PDF rows throws", async () => {
    const owner = user("restore");
    errorSpy.mockClear();
    cleanup.deleteAllPdfDocumentsForUser.mockClear();

    await call(owner, "PUT", "/Character/old_hero", {
      id: "old_hero",
      name: "Old",
    });

    const restored = await call(owner, "POST", "/restore", {
      mode: "replace",
      entities: {
        Character: [{ id: "new_hero", name: "Restored" }],
      },
    });
    expect(restored.status).toBe(200);
    expect(restored.json.restored).toBe(true);
    expect(restored.json.mode).toBe("replace");
    expect(cleanup.deleteAllPdfDocumentsForUser).toHaveBeenCalledWith(owner);
    expect(loggedAction("replace_restore")).toBe(true);

    const chars = (await call(owner, "GET", "/Character")).json as { id: string }[];
    expect(chars.map((row) => row.id)).toEqual(["new_hero"]);
  });
});
