import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/downscaleImage", () => ({
  downscaleDataUrl: vi.fn(async (url) => url),
}));

import {
  base44,
  clearAuthTokenGetter,
  setAuthTokenGetter,
} from "./base44Client";

describe("UploadFile / storage uploads", () => {
  beforeEach(() => {
    setAuthTokenGetter(() => "test-token");
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("posts the picked image to /api/storage/uploads and returns file_url", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      expect(String(url)).toContain("/api/storage/uploads");
      expect(options.method).toBe("POST");
      expect(options.credentials).toBe("same-origin");
      const body = JSON.parse(String(options.body));
      expect(body.contentType).toMatch(/^image\//);
      expect(body.dataBase64).toBeTruthy();
      return Response.json(
        {
          file_url: "/api/storage/objects/uploads/abc",
          objectPath: "/objects/uploads/abc",
        },
        { status: 201 },
      );
    });

    const file = new File([new Uint8Array([137, 80, 78, 71])], "face.png", {
      type: "image/png",
    });
    const result = await base44.integrations.Core.UploadFile({ file });
    expect(result.file_url).toBe("/api/storage/objects/uploads/abc");
    expect(result.url).toBe("/api/storage/objects/uploads/abc");
  });

  it("surfaces the server error instead of swallowing it", async () => {
    global.fetch = vi.fn(async () =>
      Response.json(
        { error: "Image is too large (max 1 MB after compression)" },
        { status: 400 },
      ),
    );
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    await expect(base44.integrations.Core.UploadFile({ file })).rejects.toThrow(
      /too large/i,
    );
  });

  it("fails clearly when the caller is not signed in", async () => {
    clearAuthTokenGetter();
    global.fetch = vi.fn();
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    await expect(base44.integrations.Core.UploadFile({ file })).rejects.toThrow(
      /sign in/i,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("explains a Worker 413 without leaving the caller empty-handed", async () => {
    global.fetch = vi.fn(async () =>
      new Response("Request Entity Too Large", { status: 413 }),
    );
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    await expect(base44.integrations.Core.UploadFile({ file })).rejects.toThrow(
      /too large/i,
    );
  });

  it("retries a 503 Hyperdrive connection reset then returns file_url", async () => {
    let posts = 0;
    global.fetch = vi.fn(async () => {
      posts += 1;
      if (posts === 1) {
        return Response.json(
          { error: "Database connection reset", reason: "reset", code: "ECONNRESET" },
          { status: 503 },
        );
      }
      return Response.json(
        { file_url: "/api/storage/objects/uploads/retried" },
        { status: 201 },
      );
    });
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    const result = await base44.integrations.Core.UploadFile({ file });
    expect(posts).toBe(2);
    expect(result.file_url).toBe("/api/storage/objects/uploads/retried");
  });

  it("retries 503 Database unavailable then returns file_url", async () => {
    let posts = 0;
    global.fetch = vi.fn(async () => {
      posts += 1;
      if (posts === 1) {
        return Response.json(
          { error: "Database unavailable", reason: "unavailable" },
          { status: 503 },
        );
      }
      return Response.json(
        { file_url: "/api/storage/objects/uploads/after-unavailable" },
        { status: 201 },
      );
    });
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    const result = await base44.integrations.Core.UploadFile({ file });
    expect(posts).toBe(2);
    expect(result.file_url).toBe("/api/storage/objects/uploads/after-unavailable");
  });

  it("explains a 503 database outage after the retry is exhausted", async () => {
    let posts = 0;
    global.fetch = vi.fn(async () => {
      posts += 1;
      return Response.json(
        { error: "Database unavailable", reason: "unavailable" },
        { status: 503 },
      );
    });
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    await expect(base44.integrations.Core.UploadFile({ file })).rejects.toThrow(
      /database|unavailable/i,
    );
    expect(posts).toBe(2);
  });

  it("does not retry a 503 schema error", async () => {
    let posts = 0;
    global.fetch = vi.fn(async () => {
      posts += 1;
      return Response.json(
        { error: "Database schema is missing or out of date", reason: "schema" },
        { status: 503 },
      );
    });
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    await expect(base44.integrations.Core.UploadFile({ file })).rejects.toThrow(
      /schema|unavailable|database/i,
    );
    expect(posts).toBe(1);
  });

  it("explains a missing Worker upload route (HTML 404)", async () => {
    global.fetch = vi.fn(async () =>
      new Response("<!doctype html><title>Not Found</title>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const file = new File([new Uint8Array([1, 2, 3])], "face.png", {
      type: "image/png",
    });
    await expect(base44.integrations.Core.UploadFile({ file })).rejects.toThrow(
      /not found|not available/i,
    );
  });
});
