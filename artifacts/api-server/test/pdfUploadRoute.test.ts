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

// No self-hosted host in tests: the pipeline goes straight to `ready` with
// full-text retrieval (vector path is covered by pdfPipeline / pdfVectorRecall).
process.env.ANIMA_PDF_EMBED_PROVIDER = "off";

import pdfRouter from "../src/routes/pdf";
import { backfillPdfPipelines, retrievePdfContext } from "../src/lib/pdf/store";
import { buildTextPdf } from "./pdfFixture";

const PREFIX = `pdfup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "16mb" }));
  app.use(pdfRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const table of ["pdf_file_parts", "pdf_chunks", "pdf_documents", "user_entities"]) {
    await getPool()
      .query(`DELETE FROM ${table} WHERE user_id LIKE $1`, [`${PREFIX}%`])
      .catch(() => {});
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function send(
  userId: string | null,
  method: string,
  path: string,
  init: { body?: BodyInit; type?: string } = {},
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(init.type ? { "Content-Type": init.type } : {}),
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: init.body,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function seedSession(userId: string, sessionId: string) {
  await getPool().query(
    `INSERT INTO user_entities (user_id, entity_name, entity_id, data) VALUES ($1, 'ChatSession', $2, $3::jsonb)`,
    [userId, sessionId, JSON.stringify({ id: sessionId, character_id: `${PREFIX}char` })],
  );
}

const uploadPath = (sessionId: string, filename = "notes.pdf") =>
  `/pdfs?scope=chat&session_id=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(filename)}`;

describe("PDF upload pipeline routes", () => {
  it("accepts a raw application/pdf upload and reports pipeline status", async () => {
    const owner = user("raw");
    const sessionId = `${PREFIX}sess_raw`;
    await seedSession(owner, sessionId);
    const bytes = buildTextPdf(["The harbor bell rings at dawn.", "The silver key opens the north gate."]);

    const created = await send(owner, "POST", uploadPath(sessionId), {
      body: bytes as unknown as BodyInit,
      type: "application/pdf",
    });
    expect(created.status).toBe(201);
    expect(created.json.file).toMatchObject({
      filename: "notes.pdf",
      scope: "chat",
      pageCount: 2,
      status: "ready",
      hasFile: true,
      byteSize: bytes.byteLength,
      error: null,
    });
    expect(created.json.file.chunkCount).toBeGreaterThan(0);
    expect(created.json.file.vectorsPending).toBe(true); // embedder off → full-text only

    const id = created.json.file.id;
    const status = await send(owner, "GET", `/pdfs/${id}`);
    expect(status.status).toBe(200);
    expect(status.json.file.status).toBe("ready");

    const stolen = await send(user("intruder"), "GET", `/pdfs/${id}`);
    expect(stolen.status).toBe(404);

    const row = await getPool().query(
      `SELECT status, content_sha256, attempts, completed_at, storage_bucket FROM pdf_documents WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({ status: "ready", attempts: 1, storage_bucket: null });
    expect(row.rows[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0].completed_at).not.toBeNull();
    const chunks = await getPool().query(
      `SELECT id, token_count FROM pdf_chunks WHERE document_id = $1 ORDER BY chunk_index`,
      [id],
    );
    expect(chunks.rows[0].id).toBe(`${id}:1:0`);
    expect(chunks.rows[0].token_count).toBeGreaterThan(0);

    const opened = await fetch(`${baseUrl}/pdfs/${id}/file`, { headers: { "x-test-user": owner } });
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(bytes);

    const context = await retrievePdfContext({
      userId: owner,
      sessionId,
      characterIds: [],
      query: "Where is the silver key?",
    });
    expect(context).toContain("silver key");
  });

  it("is idempotent for the same bytes in the same chat", async () => {
    const owner = user("dupe");
    const sessionId = `${PREFIX}sess_dupe`;
    await seedSession(owner, sessionId);
    const bytes = buildTextPdf(["Only once, please."]);
    const a = await send(owner, "POST", uploadPath(sessionId), { body: bytes as unknown as BodyInit, type: "application/pdf" });
    const b = await send(owner, "POST", uploadPath(sessionId, "again.pdf"), {
      body: bytes as unknown as BodyInit,
      type: "application/pdf",
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.file.id).toBe(a.json.file.id);
    const listed = await send(owner, "GET", `/pdfs?scope=chat&session_id=${sessionId}`);
    expect(listed.json.files).toHaveLength(1);
  });

  it("rejects wrong MIME types and non-PDF bytes before storing anything", async () => {
    const owner = user("reject");
    const sessionId = `${PREFIX}sess_reject`;
    await seedSession(owner, sessionId);
    const text = await send(owner, "POST", uploadPath(sessionId), { body: "hello", type: "text/plain" });
    expect(text.status).toBe(415);
    expect(text.json.code).toBe("pdf_not_pdf");
    const fake = await send(owner, "POST", uploadPath(sessionId), {
      body: new TextEncoder().encode("GIF89a not a pdf") as unknown as BodyInit,
      type: "application/pdf",
    });
    expect(fake.status).toBe(400);
    expect(fake.json.code).toBe("pdf_not_pdf");
    const scanned = await send(owner, "POST", uploadPath(sessionId), {
      body: buildTextPdf([""]) as unknown as BodyInit,
      type: "application/pdf",
    });
    expect(scanned.status).toBe(422);
    const rows = await getPool().query(`SELECT count(*)::int AS n FROM pdf_documents WHERE user_id = $1`, [owner]);
    expect(rows.rows[0].n).toBe(0); // a bad file leaves nothing behind
  });

  it("retries a failed document from its stored original", async () => {
    const owner = user("retry");
    const sessionId = `${PREFIX}sess_retry`;
    await seedSession(owner, sessionId);
    const created = await send(owner, "POST", uploadPath(sessionId), {
      body: buildTextPdf(["Recoverable text."]) as unknown as BodyInit,
      type: "application/pdf",
    });
    const id = created.json.file.id;
    await getPool().query(
      `UPDATE pdf_documents SET status = 'failed', error = 'boom', error_code = 'pdf_pipeline_error' WHERE id = $1`,
      [id],
    );
    const failed = await send(owner, "GET", `/pdfs/${id}`);
    expect(failed.json.file).toMatchObject({ status: "failed", errorCode: "pdf_pipeline_error" });
    // Searchable chunks are hidden while a document is failed.
    expect(
      await retrievePdfContext({ userId: owner, sessionId, characterIds: [], query: "recoverable" }),
    ).toBe("");

    const retried = await send(owner, "POST", `/pdfs/${id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.json.file).toMatchObject({ status: "ready", error: null });
    const chunk = await getPool().query(`SELECT id FROM pdf_chunks WHERE document_id = $1`, [id]);
    expect(chunk.rows.map((r) => r.id)).toEqual([`${id}:2:0`]); // re-chunked once, no duplicates

    const missing = await send(owner, "POST", `/pdfs/not-a-doc/retry`);
    expect(missing.status).toBe(404);
  });

  it("lets the cron reclaim an upload whose isolate died mid-pipeline", async () => {
    const owner = user("stale");
    const sessionId = `${PREFIX}sess_stale`;
    await seedSession(owner, sessionId);
    const created = await send(owner, "POST", uploadPath(sessionId), {
      body: buildTextPdf(["Abandoned then resumed."]) as unknown as BodyInit,
      type: "application/pdf",
    });
    const id = created.json.file.id;
    await getPool().query(
      `UPDATE pdf_documents SET status = 'extracting', processing_started_at = now() - interval '10 minutes' WHERE id = $1`,
      [id],
    );
    const summary = await backfillPdfPipelines({ maxDocuments: 32 });
    expect(summary.resumed).toBeGreaterThanOrEqual(1);
    const after = await send(owner, "GET", `/pdfs/${id}`);
    expect(after.json.file.status).toBe("ready");
  });

  it("deletes the document, its chunks, and its stored original", async () => {
    const owner = user("delete");
    const sessionId = `${PREFIX}sess_delete`;
    await seedSession(owner, sessionId);
    const created = await send(owner, "POST", uploadPath(sessionId), {
      body: buildTextPdf(["Delete me."]) as unknown as BodyInit,
      type: "application/pdf",
    });
    const id = created.json.file.id;
    expect((await send(user("intruder"), "DELETE", `/pdfs/${id}`)).status).toBe(404);
    expect((await send(owner, "DELETE", `/pdfs/${id}`)).status).toBe(204);
    expect((await send(owner, "GET", `/pdfs/${id}`)).status).toBe(404);
    for (const table of ["pdf_chunks", "pdf_file_parts"]) {
      const rows = await getPool().query(`SELECT count(*)::int AS n FROM ${table} WHERE document_id = $1`, [id]);
      expect(rows.rows[0].n).toBe(0);
    }
  });
});
