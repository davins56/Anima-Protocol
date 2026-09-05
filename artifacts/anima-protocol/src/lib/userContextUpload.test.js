import { describe, expect, it, vi } from "vitest";
import {
  formatUserContextUploadError,
  uploadUserContextStorageFile,
  userContextNeedsStorageUpload,
} from "./userContextUpload";

describe("userContextUpload", () => {
  it("only posts images to /api/storage/uploads", () => {
    expect(userContextNeedsStorageUpload(true)).toBe(true);
    expect(userContextNeedsStorageUpload(false)).toBe(false);
  });

  it("returns the stored file_url for an image", async () => {
    const file = new File(["fake"], "page.png", { type: "image/png" });
    const uploadFile = vi.fn(async () => ({
      file_url: "/api/storage/objects/uploads/page-1",
    }));
    await expect(uploadUserContextStorageFile(file, uploadFile)).resolves.toBe(
      "/api/storage/objects/uploads/page-1",
    );
    expect(uploadFile).toHaveBeenCalledWith({ file });
  });

  it("surfaces auth and size failures instead of a generic retry", () => {
    expect(formatUserContextUploadError(new Error("Unauthorized"))).toMatch(
      /sign in/i,
    );
    expect(formatUserContextUploadError(new Error("too large"))).toMatch(
      /too large/i,
    );
  });
});
