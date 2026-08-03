import { describe, expect, it } from "vitest";
import {
  isDbUploadObjectPath,
  objectPathForUploadId,
  parseImagePayload,
  uploadIdFromObjectPath,
} from "../src/lib/imageUploads";

describe("imageUploads helpers", () => {
  it("recognizes DB upload object paths", () => {
    expect(isDbUploadObjectPath("/objects/uploads/abc")).toBe(true);
    expect(isDbUploadObjectPath("/objects/other/abc")).toBe(false);
    expect(objectPathForUploadId("abc-123")).toBe("/objects/uploads/abc-123");
    expect(uploadIdFromObjectPath("/objects/uploads/abc-123")).toBe("abc-123");
  });

  it("parses data URLs", () => {
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const parsed = parseImagePayload({
      dataUrl: `data:image/png;base64,${tinyPng}`,
    });
    expect(parsed.contentType).toBe("image/png");
    expect(parsed.dataBase64).toBe(tinyPng);
    expect(parsed.byteSize).toBeGreaterThan(0);
  });

  it("parses raw base64 + contentType", () => {
    const parsed = parseImagePayload({
      contentType: "image/jpeg",
      dataBase64: Buffer.from("hello").toString("base64"),
    });
    expect(parsed.contentType).toBe("image/jpeg");
    expect(parsed.byteSize).toBe(5);
  });

  it("rejects non-images and empty payloads", () => {
    expect(() =>
      parseImagePayload({ contentType: "application/pdf", dataBase64: "QQ==" }),
    ).toThrow(/Only image/i);
    expect(() =>
      parseImagePayload({ contentType: "image/png", dataBase64: "" }),
    ).toThrow(/Missing image data/i);
  });
});
