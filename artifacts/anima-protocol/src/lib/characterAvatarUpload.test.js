import { describe, expect, it, vi } from "vitest";
import {
  avatarUrlFromUploadResult,
  characterCreatePayload,
  formatAvatarUploadError,
  persistDataUrlWithInlineFallback,
  persistPortraitWithInlineFallback,
  uploadCharacterAvatar,
  verifyPortraitUrl,
} from "./characterAvatarUpload";

describe("characterAvatarUpload", () => {
  it("accepts file_url or legacy url from UploadFile", () => {
    expect(
      avatarUrlFromUploadResult({
        file_url: "/api/storage/objects/uploads/a",
      }),
    ).toBe("/api/storage/objects/uploads/a");
    expect(
      avatarUrlFromUploadResult({ url: "/api/storage/objects/uploads/b" }),
    ).toBe("/api/storage/objects/uploads/b");
    expect(avatarUrlFromUploadResult({ file_url: null, url: null })).toBeNull();
    expect(avatarUrlFromUploadResult({})).toBeNull();
  });

  it("uploads a picked file and returns the persisted Character avatar_url", async () => {
    const file = new File(["fake"], "face.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({
      file_url: "/api/storage/objects/uploads/char-1",
    }));

    await expect(uploadCharacterAvatar(file, uploadFile)).resolves.toBe(
      "/api/storage/objects/uploads/char-1",
    );
    expect(uploadFile).toHaveBeenCalledWith({ file });
  });

  it("throws a real error when UploadFile returns no URL (does not swallow)", async () => {
    const file = new File(["fake"], "face.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({ file_url: null, url: null }));

    await expect(uploadCharacterAvatar(file, uploadFile)).rejects.toThrow(
      /no file URL/i,
    );
  });

  it("rejects non-image files before calling the uploader", async () => {
    const file = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    const uploadFile = vi.fn();

    await expect(uploadCharacterAvatar(file, uploadFile)).rejects.toThrow(
      /not an image/i,
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("includes avatar_url on the Character.create payload", () => {
    const payload = characterCreatePayload({
      name: "  Korra  ",
      universe: "Legend of Korra",
      avatar_url: "  /api/storage/objects/uploads/korra  ",
      category: "warrior",
    });
    expect(payload.name).toBe("Korra");
    expect(payload.avatar_url).toBe("/api/storage/objects/uploads/korra");
    expect(payload.universe).toBe("Legend of Korra");
    expect(payload.image_data_url).toBeUndefined();
  });

  it("copies an inline avatar onto image_data_url so the portrait survives a null file_url", () => {
    const dataUrl = "data:image/png;base64,aaa";
    const payload = characterCreatePayload({
      name: "Korra",
      avatar_url: dataUrl,
    });
    expect(payload.avatar_url).toBe(dataUrl);
    expect(payload.image_data_url).toBe(dataUrl);
  });

  it("falls back to image_data_url when UploadFile is the MEMORY.md stub ({ url: null })", async () => {
    const file = new File(["fake-bytes"], "face.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({ file_url: null, url: null }));
    const downscale = vi.fn(async (url) => url);

    const persisted = await persistPortraitWithInlineFallback(file, uploadFile, {
      downscale,
      verifyUrl: async () => true,
    });

    expect(persisted.inline).toBe(true);
    expect(persisted.url).toMatch(/^data:/);
    expect(persisted.image_data_url).toMatch(/^data:/);
    expect(persisted.warning).toMatch(/no fetchable file URL/i);
    expect(uploadFile).toHaveBeenCalled();
  });

  it("falls back to image_data_url when the Worker cannot serve the storage path", async () => {
    const file = new File(["fake-bytes"], "face.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({
      file_url: "/api/storage/objects/uploads/broken",
    }));
    const downscale = vi.fn(async (url) => url);

    const persisted = await persistPortraitWithInlineFallback(file, uploadFile, {
      downscale,
      verifyUrl: async () => false,
    });

    expect(persisted.inline).toBe(true);
    expect(persisted.url).toMatch(/^data:/);
    expect(persisted.file_url).toBe("/api/storage/objects/uploads/broken");
    expect(persisted.warning).toMatch(/cannot serve/i);
  });

  it("keeps the storage file_url when the Worker serves the image", async () => {
    const file = new File(["fake-bytes"], "face.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({
      file_url: "/api/storage/objects/uploads/ok",
    }));
    const downscale = vi.fn(async (url) => url);

    const persisted = await persistPortraitWithInlineFallback(file, uploadFile, {
      downscale,
      verifyUrl: async (url) => url === "/api/storage/objects/uploads/ok",
    });

    expect(persisted.inline).toBe(false);
    expect(persisted.url).toBe("/api/storage/objects/uploads/ok");
    expect(persisted.image_data_url).toMatch(/^data:/);
    expect(persisted.warning).toBeUndefined();
  });

  it("persistDataUrlWithInlineFallback keeps the data URL when persistFn returns null", async () => {
    const dataUrl = "data:image/png;base64,aaa";
    const persistFn = vi.fn(async () => null);
    const persisted = await persistDataUrlWithInlineFallback(dataUrl, persistFn, {
      verifyUrl: async () => false,
    });
    expect(persisted.inline).toBe(true);
    expect(persisted.url).toBe(dataUrl);
    expect(persisted.image_data_url).toBe(dataUrl);
    expect(persisted.warning).toMatch(/no fetchable file URL/i);
  });

  it("persistDataUrlWithInlineFallback keeps the data URL when the Worker cannot serve persistFn's path", async () => {
    const dataUrl = "data:image/png;base64,aaa";
    const persistFn = vi.fn(async () => "/api/storage/objects/uploads/broken");
    const persisted = await persistDataUrlWithInlineFallback(dataUrl, persistFn, {
      verifyUrl: async () => false,
    });
    expect(persisted.inline).toBe(true);
    expect(persisted.url).toBe(dataUrl);
    expect(persisted.warning).toMatch(/cannot serve/i);
  });

  it("treats an HTML 404 from /api/storage as unservable", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<!doctype html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(
      verifyPortraitUrl("/api/storage/objects/uploads/x", fetchImpl),
    ).resolves.toBe(false);
  });

  it("maps auth / size / HEIC failures to a visible message", () => {
    expect(formatAvatarUploadError(new Error("Unauthorized"))).toMatch(/sign in/i);
    expect(formatAvatarUploadError(new Error("Image is too large"))).toMatch(
      /too large/i,
    );
    expect(formatAvatarUploadError(new Error("Failed to load HEIC"))).toMatch(
      /HEIC/i,
    );
    expect(formatAvatarUploadError(new Error("not found"))).toMatch(/not available/i);
  });
});
