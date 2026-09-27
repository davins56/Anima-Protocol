import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { getPool } from "@workspace/db";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import pdfRouter from "../src/routes/pdf";
import storeRouter from "../src/routes/store";
import { retrievePdfContext } from "../src/lib/pdf/store";
import { PDF_CONTEXT_CHAR_BUDGET } from "../src/lib/pdf/limits";
import { pdfBase64 } from "./pdfFixture";

const PREFIX = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "16mb" }));
  app.use("/store", storeRouter);
  app.use(pdfRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await getPool()
    .query(`DELETE FROM pdf_chunks WHERE user_id LIKE $1`, [`${PREFIX}%`])
    .catch(() => {});
  await getPool()
    .query(`DELETE FROM pdf_documents WHERE user_id LIKE $1`, [`${PREFIX}%`])
    .catch(() => {});
  await getPool()
    .query(`DELETE FROM user_entities WHERE user_id LIKE $1`, [`${PREFIX}%`])
    .catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(
  userId: string | null,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
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

async function seedEntity(
  userId: string,
  entityName: string,
  entityId: string,
) {
  await getPool().query(
    `INSERT INTO user_entities (user_id, entity_name, entity_id, data)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, entityName, entityId, JSON.stringify({ id: entityId, name: entityId })],
  );
}

describe("PDF documents", () => {
  it("stores a chat PDF for the owner and hides it from everyone else", async () => {
    const owner = user("owner");
    const other = user("other");
    const sessionId = `${PREFIX}sess`;
    await seedEntity(owner, "ChatSession", sessionId);

    const created = await call(owner, "POST", "/pdfs", {
      filename: "notes.pdf",
      scope: "chat",
      session_id: sessionId,
      dataBase64: pdfBase64([
        "The harbor bell rings at dawn.",
        "The silver key opens the north gate.",
      ]),
    });
    expect(created.status).toBe(201);
    expect(created.json.file.filename).toBe("notes.pdf");
    expect(created.json.file.byteSize).toBeGreaterThan(0);
    expect(created.json.file.pageCount).toBe(2);
    expect(created.json.file.chunkCount).toBeGreaterThan(0);
    expect(JSON.stringify(created.json)).not.toContain("silver key");

    const listed = await call(
      owner,
      "GET",
      `/pdfs?scope=chat&session_id=${encodeURIComponent(sessionId)}`,
    );
    expect(listed.status).toBe(200);
    expect(listed.json.files).toHaveLength(1);

    const hidden = await call(
      other,
      "GET",
      `/pdfs?scope=chat&session_id=${encodeURIComponent(sessionId)}`,
    );
    expect(hidden.json.files).toEqual([]);

    const stolen = await call(other, "DELETE", `/pdfs/${created.json.file.id}`);
    expect(stolen.status).toBe(404);

    const renamed = await call(other, "PATCH", `/pdfs/${created.json.file.id}`, {
      filename: "stolen.pdf",
    });
    expect(renamed.status).toBe(404);

    const context = await retrievePdfContext({
      userId: owner,
      sessionId,
      characterIds: [],
      query: "Where is the silver key?",
    });
    expect(context).toContain("silver key");
    expect(context.length).toBeLessThanOrEqual(PDF_CONTEXT_CHAR_BUDGET);

    const leaked = await retrievePdfContext({
      userId: other,
      sessionId,
      characterIds: [],
      query: "Where is the silver key?",
    });
    expect(leaked).toBe("");

    const removed = await call(owner, "DELETE", `/pdfs/${created.json.file.id}`);
    expect(removed.status).toBe(204);
    const chunks = await getPool().query(
      `SELECT count(*)::int AS n FROM pdf_chunks WHERE user_id = $1 AND document_id = $2`,
      [owner, created.json.file.id],
    );
    expect(Number(chunks.rows[0]?.n)).toBe(0);
  });

  it("deletes lore chunks when the companion is deleted", async () => {
    const owner = user("lore");
    const characterId = `${PREFIX}char`;
    await seedEntity(owner, "Character", characterId);
    const created = await call(owner, "POST", "/pdfs", {
      filename: "world-bible.pdf",
      scope: "lore",
      character_id: characterId,
      dataBase64: pdfBase64(["The north gate hides the silver key."]),
    });
    expect(created.status).toBe(201);
    const docId = created.json.file.id as string;

    const context = await retrievePdfContext({
      userId: owner,
      sessionId: `${PREFIX}unused`,
      characterIds: [characterId],
      query: "Tell me about the silver key",
    });
    expect(context).toContain("silver key");
    expect(context.length).toBeLessThanOrEqual(PDF_CONTEXT_CHAR_BUDGET);

    const deleted = await call(owner, "DELETE", `/store/Character/${characterId}`);
    expect(deleted.status).toBe(204);
    const chunks = await getPool().query(
      `SELECT count(*)::int AS n FROM pdf_chunks WHERE user_id = $1 AND document_id = $2`,
      [owner, docId],
    );
    expect(Number(chunks.rows[0]?.n)).toBe(0);
    const docs = await getPool().query(
      `SELECT count(*)::int AS n FROM pdf_documents WHERE user_id = $1 AND id = $2`,
      [owner, docId],
    );
    expect(Number(docs.rows[0]?.n)).toBe(0);
  });

  it("tells the user when a PDF has no text", async () => {
    const owner = user("blank");
    const sessionId = `${PREFIX}blanksess`;
    await seedEntity(owner, "ChatSession", sessionId);
    const created = await call(owner, "POST", "/pdfs", {
      filename: "scan.pdf",
      scope: "chat",
      session_id: sessionId,
      dataBase64: pdfBase64([""]),
    });
    expect(created.status).toBe(422);
    expect(created.json.code).toBe("pdf_no_text");
    expect(String(created.json.error)).toMatch(/no extractable text/i);
  });

  it("rejects an anonymous upload", async () => {
    const created = await call(null, "POST", "/pdfs", {
      filename: "notes.pdf",
      scope: "chat",
      session_id: "sess_x",
      dataBase64: pdfBase64(["hello"]),
    });
    expect(created.status).toBe(401);
  });
});
