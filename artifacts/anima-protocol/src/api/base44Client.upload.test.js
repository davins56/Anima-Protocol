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
        { error: "Image is too large (max 4 MB after compression)" },
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

  it("re-POSTs to the apex API path when www 301s to /", async () => {
    let calls = 0;
    global.fetch = vi.fn(async (url, options = {}) => {
      calls += 1;
      if (calls === 1) {
        expect(options.method).toBe("POST");
        expect(options.redirect).toBe("manual");
        const body = JSON.parse(String(options.body));
        expect(body.contentType).toMatch(/^image\//);
        expect(body.dataBase64).toBeTruthy();
        return new Response("", {
          status: 301,
          headers: { Location: "https://anima-protocol.com/" },
        });
      }
      expect(String(url)).toBe(
        "https://anima-protocol.com/api/storage/uploads",
      );
      expect(options.method).toBe("POST");
      return Response.json(
        { objectPath: "/objects/uploads/from-redirect" },
        { status: 201 },
      );
    });

    const file = new File([new Uint8Array([137, 80, 78, 71])], "face.png", {
      type: "image/png",
    });
    const result = await base44.integrations.Core.UploadFile({ file });
    expect(result.file_url).toBe("/api/storage/objects/uploads/from-redirect");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("treats an HTML 200 homepage as a missing Worker upload route", async () => {
    global.fetch = vi.fn(async () =>
      new Response("<!doctype html><title>Anima</title>", {
        status: 200,
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
