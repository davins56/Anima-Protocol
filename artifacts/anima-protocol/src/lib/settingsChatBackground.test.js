import { describe, expect, it, vi } from "vitest";
import {
  chatBackgroundUrlFromUploadResult,
  formatChatBackgroundUploadError,
  persistChatBackgroundSettings,
  uploadChatBackgroundImage,
} from "./settingsChatBackground";

describe("settingsChatBackground", () => {
  it("uploads through UploadFile and returns the storage path", async () => {
    const file = new File(["fake"], "bg.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({
      file_url: "/api/storage/objects/uploads/bg-1",
    }));
    await expect(uploadChatBackgroundImage(file, uploadFile)).resolves.toBe(
      "/api/storage/objects/uploads/bg-1",
    );
    expect(uploadFile).toHaveBeenCalledWith({ file });
  });

  it("accepts the legacy url field", () => {
    expect(
      chatBackgroundUrlFromUploadResult({
        url: "/api/storage/objects/uploads/legacy",
      }),
    ).toBe("/api/storage/objects/uploads/legacy");
  });

  it("persists the same-origin file_url onto user settings", async () => {
    const updateMe = vi.fn(async () => ({}));
    const next = await persistChatBackgroundSettings({
      prefs: { display_name: "Ada", chat_bg_theme: "default", theme_mode: "dark" },
      fileUrl: "/api/storage/objects/uploads/bg-2",
      updateMe,
    });
    expect(next.chat_bg_image).toBe("/api/storage/objects/uploads/bg-2");
    expect(next.chat_bg_theme).toBe("custom");
    expect(updateMe).toHaveBeenCalledWith({
      settings: next,
      display_name: "Ada",
    });
  });

  it("maps auth / size / DB failures to a visible message", () => {
    expect(formatChatBackgroundUploadError(new Error("Unauthorized"))).toMatch(
      /sign in/i,
    );
    expect(
      formatChatBackgroundUploadError(new Error("Image is too large")),
    ).toMatch(/too large/i);
    expect(
      formatChatBackgroundUploadError(
        new Error("Database host unreachable"),
      ),
    ).toMatch(/database|unavailable/i);
  });

  it("does not swallow a missing file URL", async () => {
    const file = new File(["fake"], "bg.png", { type: "image/png" });
    await expect(
      uploadChatBackgroundImage(file, async () => ({ file_url: null })),
    ).rejects.toThrow(/no file URL/i);
  });
});
