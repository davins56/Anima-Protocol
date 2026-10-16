import { describe, expect, it } from "vitest";
import {
  CHAT_PHOTO_ACCEPT,
  CHAT_PHOTO_MAX_SOURCE_BYTES,
  chatPhotoRejection,
} from "./chatPhoto";

function file(name, type, size = 32) {
  const blob = new File([new Uint8Array(size)], name, { type });
  return blob;
}

describe("chat photo checks", () => {
  it("accepts jpeg, png, webp, and heic, including an iPhone file with no mime type", () => {
    expect(chatPhotoRejection(file("shot.jpg", "image/jpeg"))).toBeNull();
    expect(chatPhotoRejection(file("shot.png", "image/png"))).toBeNull();
    expect(chatPhotoRejection(file("shot.webp", "image/webp"))).toBeNull();
    expect(chatPhotoRejection(file("shot.HEIC", "image/heic"))).toBeNull();
    expect(chatPhotoRejection(file("IMG_2201.HEIC", ""))).toBeNull();
    expect(CHAT_PHOTO_ACCEPT).toContain("image/*");
    expect(CHAT_PHOTO_ACCEPT).toContain(".heic");
  });

  it("rejects other types, empty files, and photos over the phone-file cap", () => {
    expect(chatPhotoRejection(file("clip.mp3", "audio/mpeg"))).toMatch(/jpeg, png, webp, or heic/i);
    expect(chatPhotoRejection(file("notes.pdf", "application/pdf"))).toMatch(/jpeg, png, webp, or heic/i);
    expect(chatPhotoRejection(file("anim.gif", "image/gif"))).toMatch(/jpeg, png, webp, or heic/i);
    expect(chatPhotoRejection(file("empty.jpg", "image/jpeg", 0))).toMatch(/empty/i);
    expect(
      chatPhotoRejection(file("huge.jpg", "image/jpeg", CHAT_PHOTO_MAX_SOURCE_BYTES + 1)),
    ).toMatch(/15 MB/);
  });
});
