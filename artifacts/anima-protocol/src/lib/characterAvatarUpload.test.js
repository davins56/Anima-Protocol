import { describe, expect, it, vi } from "vitest";
import {
  avatarUrlFromUploadResult,
  characterCreatePayload,
  formatAvatarUploadError,
  formatImageUploadError,
  uploadCharacterAvatar,
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
    expect(
      formatImageUploadError(new Error("Database connection reset"), {
        noun: "image",
      }),
    ).toMatch(/database|unavailable/i);
  });
});
