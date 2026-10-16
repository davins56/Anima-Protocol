import { describe, expect, it } from "vitest";
import {
  httpStatusForUploadError,
  isDbUploadObjectPath,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ERROR,
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

  it("parses jpeg, webp, and heic, and rejects a type that does not match the bytes", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const parsed = parseImagePayload({
      contentType: "image/jpg",
      dataBase64: jpeg.toString("base64"),
    });
    expect(parsed.contentType).toBe("image/jpeg");
    expect(parsed.byteSize).toBe(jpeg.length);

    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([16, 0, 0, 0]),
      Buffer.from("WEBP"),
    ]);
    expect(
      parseImagePayload({ contentType: "image/webp", dataBase64: webp.toString("base64") })
        .contentType,
    ).toBe("image/webp");

    const heic = Buffer.alloc(16);
    heic.writeUInt32BE(16, 0);
    heic.write("ftyp", 4, "ascii");
    heic.write("heic", 8, "ascii");
    expect(
      parseImagePayload({ contentType: "image/heic", dataBase64: heic.toString("base64") })
        .contentType,
    ).toBe("image/heic");

    expect(() =>
      parseImagePayload({
        contentType: "image/jpeg",
        dataBase64: Buffer.from("hello").toString("base64"),
      }),
    ).toThrow(/doesn't look like/i);

    const wave = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([16, 0, 0, 0]),
      Buffer.from("WAVE"),
    ]);
    expect(() =>
      parseImagePayload({ contentType: "image/webp", dataBase64: wave.toString("base64") }),
    ).toThrow(/doesn't look like/i);

    const mp4 = Buffer.alloc(16);
    mp4.writeUInt32BE(16, 0);
    mp4.write("ftyp", 4, "ascii");
    mp4.write("mp42", 8, "ascii");
    expect(() =>
      parseImagePayload({ contentType: "image/heic", dataBase64: mp4.toString("base64") }),
    ).toThrow(/doesn't look like/i);

    const shortPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
    expect(() =>
      parseImagePayload({ contentType: "image/png", dataBase64: shortPng.toString("base64") }),
    ).toThrow(/doesn't look like/i);
    expect(() =>
      parseImagePayload({
        contentType: "image/gif",
        dataBase64: Buffer.from("GIF89a").toString("base64"),
      }),
    ).toThrow(/JPEG, PNG, WebP, or HEIC/i);
  });

  it("rejects an oversized payload from its encoded length", () => {
    const tooLong = "A".repeat(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4);
    expect(() =>
      parseImagePayload({ contentType: "image/jpeg", dataBase64: tooLong }),
    ).toThrow(/too large/i);
  });

  it("rejects non-images and empty payloads", () => {
    expect(() =>
      parseImagePayload({ contentType: "application/pdf", dataBase64: "QQ==" }),
    ).toThrow(/Only image/i);
    expect(() =>
      parseImagePayload({ contentType: "image/png", dataBase64: "" }),
    ).toThrow(/Missing image data/i);
  });

  it("rejects oversized payloads and maps them to 413", () => {
    const tooBig = "A".repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3) + 16);
    expect(() =>
      parseImagePayload({ contentType: "image/jpeg", dataBase64: tooBig }),
    ).toThrow(MAX_UPLOAD_ERROR);
    expect(httpStatusForUploadError(new Error(MAX_UPLOAD_ERROR))).toBe(413);
    expect(httpStatusForUploadError(new Error("Only image uploads are supported"))).toBe(400);
  });
});
