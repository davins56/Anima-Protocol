import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Companion chat photos are 1024×1536 since #720 and often land at
 * 0.8–1.5 MB. Over the 1 MB single-row cap they used to fail storage, so the
 * companion said "the photo won't send right now". They are now stored as
 * part rows plus a manifest under one id (mocked pool, no Postgres).
 */
type Row = { id: string; user_id: string; content_type: string; data_base64: string; byte_size: number };
const rows = new Map<string, Row>();
const insertSizes: number[] = [];

const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  const text = sql.replace(/\s+/g, " ").trim();
  if (text.startsWith("INSERT INTO uploaded_images")) {
    const [id, user_id, content_type, data_base64, byte_size] = params as [string, string, string, string, number];
    insertSizes.push(String(data_base64).length);
    rows.set(id, { id, user_id, content_type, data_base64, byte_size });
    return { rows: [] };
  }
  if (text.startsWith("SELECT id, user_id, content_type, data_base64, byte_size FROM uploaded_images WHERE id = $1")) {
    const row = rows.get(String(params[0]));
    return { rows: row ? [row] : [] };
  }
  if (text.startsWith("SELECT id, data_base64 FROM uploaded_images")) {
    const [userId, ...ids] = params as string[];
    const out = ids
      .map((id) => rows.get(id))
      .filter((r): r is Row => Boolean(r && r.user_id === userId && r.content_type === "application/x-anima-image-part"));
    // Out of order on purpose: assembly must follow the manifest.
    return { rows: out.reverse().map((r) => ({ id: r.id, data_base64: r.data_base64 })) };
  }
  if (text.startsWith("DELETE FROM uploaded_images WHERE id = $1")) {
    const row = rows.get(String(params[0]));
    if (!row || row.user_id !== params[1] || row.content_type === "application/x-anima-image-part") return { rows: [] };
    rows.delete(row.id);
    return { rows: [{ id: row.id, content_type: row.content_type, data_base64: row.data_base64 }] };
  }
  if (text.startsWith("DELETE FROM uploaded_images WHERE user_id = $1")) {
    const [userId, ...ids] = params as string[];
    for (const id of ids) if (rows.get(id)?.user_id === userId) rows.delete(id);
    return { rows: [] };
  }
  throw new Error(`unexpected SQL: ${text}`);
});

vi.mock("@workspace/db", () => ({
  getPool: () => ({ query }),
  ensureSchemaOnce: async () => undefined,
  withTransientDbRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import {
  deleteUploadedImage,
  GENERATED_PART_BYTES,
  getUploadedImage,
  MAX_UPLOAD_BYTES,
  objectPathForUploadId,
  splitImageBytes,
  storeGeneratedImage,
} from "../src/lib/imageUploads";

function fakeJpeg(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 31 + 7) & 0xff;
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

describe("storeGeneratedImage", () => {
  beforeEach(() => {
    rows.clear();
    insertSizes.length = 0;
    query.mockClear();
  });

  it("part size is a multiple of 3 so base64 parts concatenate", () => {
    expect(GENERATED_PART_BYTES % 3).toBe(0);
    expect(GENERATED_PART_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    const parts = splitImageBytes(new Uint8Array(10), 4);
    expect(parts.map((p) => p.byteLength)).toEqual([4, 4, 2]);
  });

  it("keeps a photo under 1 MB in one row, as before", async () => {
    const jpeg = fakeJpeg(200_000);
    const stored = await storeGeneratedImage("u1", { contentType: "image/jpeg", dataBase64: jpeg.toString("base64") });
    expect(rows.size).toBe(1);
    expect(rows.get(stored.id)?.content_type).toBe("image/jpeg");
    const back = await getUploadedImage(objectPathForUploadId(stored.id));
    expect(Buffer.from(back!.dataBase64, "base64").equals(jpeg)).toBe(true);
  });

  it("stores a 1.4 MB high-res photo as parts and serves it back byte-for-byte", async () => {
    const jpeg = fakeJpeg(1_400_000);
    const stored = await storeGeneratedImage("u1", { contentType: "image/jpeg", dataBase64: jpeg.toString("base64") });
    expect(stored.byteSize).toBe(1_400_000);
    expect(stored.objectPath).toBe(`/objects/uploads/${stored.id}`);
    // 3 parts + manifest, and no single INSERT carries more than one part.
    expect(rows.size).toBe(4);
    expect(Math.max(...insertSizes)).toBeLessThanOrEqual(Math.ceil(GENERATED_PART_BYTES / 3) * 4);
    const back = await getUploadedImage(objectPathForUploadId(stored.id));
    expect(back?.contentType).toBe("image/jpeg");
    expect(back?.byteSize).toBe(1_400_000);
    expect(Buffer.from(back!.dataBase64, "base64").equals(jpeg)).toBe(true);
  });

  it("never serves a part row on its own URL", async () => {
    const stored = await storeGeneratedImage("u1", {
      contentType: "image/jpeg",
      dataBase64: fakeJpeg(1_200_000).toString("base64"),
    });
    const partId = [...rows.keys()].find((id) => id !== stored.id)!;
    expect(await getUploadedImage(objectPathForUploadId(partId))).toBeNull();
  });

  it("returns null (404) when a part is missing rather than a broken image", async () => {
    const stored = await storeGeneratedImage("u1", {
      contentType: "image/jpeg",
      dataBase64: fakeJpeg(1_200_000).toString("base64"),
    });
    const partId = [...rows.keys()].find((id) => id !== stored.id)!;
    rows.delete(partId);
    expect(await getUploadedImage(objectPathForUploadId(stored.id))).toBeNull();
  });

  it("rejects bytes that are not the declared image type, and over 8 MB", async () => {
    await expect(
      storeGeneratedImage("u1", { contentType: "image/png", dataBase64: fakeJpeg(1_200_000).toString("base64") }),
    ).rejects.toThrow(/doesn't look like/);
    await expect(
      storeGeneratedImage("u1", { contentType: "image/jpeg", dataBase64: fakeJpeg(9 * 1024 * 1024).toString("base64") }),
    ).rejects.toThrow(/too large/);
    expect(rows.size).toBe(0);
  });

  it("owner delete removes the manifest and its parts; others cannot delete", async () => {
    const stored = await storeGeneratedImage("u1", {
      contentType: "image/jpeg",
      dataBase64: fakeJpeg(1_200_000).toString("base64"),
    });
    expect(await deleteUploadedImage("u2", stored.id)).toBe(false);
    expect(rows.size).toBe(4);
    expect(await deleteUploadedImage("u1", stored.id)).toBe(true);
    expect(rows.size).toBe(0);
  });

  it("cleans up parts when a later insert fails", async () => {
    let calls = 0;
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("INSERT INTO uploaded_images")) {
        calls += 1;
        if (calls === 3) throw new Error("connection reset");
        const [id, user_id, content_type, data_base64, byte_size] = params as [string, string, string, string, number];
        rows.set(id, { id, user_id, content_type, data_base64, byte_size });
        return { rows: [] };
      }
      if (text.startsWith("DELETE FROM uploaded_images WHERE user_id = $1")) {
        const [, ...ids] = params as string[];
        for (const id of ids) rows.delete(id);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${text}`);
    });
    await expect(
      storeGeneratedImage("u1", { contentType: "image/jpeg", dataBase64: fakeJpeg(1_400_000).toString("base64") }),
    ).rejects.toThrow(/connection reset/);
    expect(rows.size).toBe(0);
  });
});
