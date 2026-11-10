import { describe, expect, it } from "vitest";
import { isCacheFirstImageUrl } from "./pwaImageCache";

const cached = (href) => isCacheFirstImageUrl({ url: new URL(href) });

describe("isCacheFirstImageUrl", () => {
  it("keeps public/ art and plain image files cached", () => {
    expect(cached("https://anima-protocol.com/avatars/korra.jpg")).toBe(true);
    expect(cached("https://anima-protocol.com/icon-512.png")).toBe(true);
    expect(cached("https://anima-protocol.com/serenity-presence.webp")).toBe(true);
    expect(cached("https://anima-protocol.com/favicon.ico")).toBe(true);
    expect(cached("https://anima-protocol.com/logo.svg")).toBe(true);
    expect(cached("https://upload.wikimedia.org/wikipedia/en/a/ab/Korra.PNG")).toBe(true);
    expect(cached("https://proj.supabase.co/storage/v1/object/public/avatars/a.png")).toBe(true);
  });

  it("never caches API image routes, including vessel and photo redirects", () => {
    for (const href of [
      "https://anima-protocol.com/api/photo/images/abc/file",
      "https://anima-protocol.com/api/photo/images/abc/file.png",
      "https://anima-protocol.com/api/vessel/char_1/snapshot",
      "https://anima-protocol.com/api/vessel/char_1/snapshot.png",
      "https://anima-protocol.com/api/vessel/char_1/model",
      "https://anima-protocol.com/api/vessel/char_1/model?as=json",
      "https://anima-protocol.com/api/storage/objects/uploads/123.png",
      "https://api.anima-protocol.com/api/storage/public-objects/x.jpg",
      "https://anima-protocol.com/api/character-image?name=Korra",
    ]) {
      expect(cached(href), href).toBe(false);
    }
  });

  it("never caches signed or authenticated Supabase Storage URLs", () => {
    expect(
      cached("https://proj.supabase.co/storage/v1/object/sign/companion-photos/u/c/1.png?token=eyJ.abc"),
    ).toBe(false);
    // Even if a signed path ever came back without its query string.
    expect(cached("https://proj.supabase.co/storage/v1/object/sign/companion-photos/u/1.png")).toBe(false);
    expect(cached("https://proj.supabase.co/storage/v1/object/authenticated/b/1.webp")).toBe(false);
    expect(cached("https://proj.supabase.co/storage/v1/render/image/sign/b/1.jpg?token=t")).toBe(false);
  });

  it("never caches URLs with signature or token params", () => {
    for (const href of [
      "https://cdn.example.com/a.png?token=abc",
      "https://bucket.s3.amazonaws.com/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef",
      "https://storage.googleapis.com/b/a.webp?X-Goog-Signature=abc&X-Goog-Expires=3600",
      "https://d111.cloudfront.net/a.png?Expires=1&Signature=x&Key-Pair-Id=K",
      "https://acct.blob.core.windows.net/c/a.png?sv=2024&se=2026&sp=r&sig=abc",
    ]) {
      expect(cached(href), href).toBe(false);
    }
  });

  it("matches the old rule for other query strings and non-images", () => {
    expect(cached("https://anima-protocol.com/avatars/korra.jpg?v=2")).toBe(false);
    expect(cached("https://anima-protocol.com/assets/index-abc.js")).toBe(false);
    expect(cached("https://anima-protocol.com/manifest.json")).toBe(false);
  });

  it("never caches 3D model downloads", () => {
    for (const href of [
      "https://proj.supabase.co/storage/v1/object/sign/character-models/u/c/model.vrm?token=t",
      "https://proj.supabase.co/storage/v1/object/public/character-models/u/c/model.glb",
      "https://anima-protocol.com/models/korra.vrm",
      "https://anima-protocol.com/models/korra.gltf",
    ]) {
      expect(cached(href), href).toBe(false);
    }
  });

  it("accepts string URLs and rejects junk", () => {
    expect(isCacheFirstImageUrl({ url: "/avatars/korra.jpg" })).toBe(true);
    expect(isCacheFirstImageUrl({ url: "/api/vessel/c/snapshot" })).toBe(false);
    expect(isCacheFirstImageUrl({ url: "data:image/png;base64,AAAA" })).toBe(false);
    expect(isCacheFirstImageUrl({ url: "http://[bad" })).toBe(false);
  });

  it("survives Workbox's toString() serialization (self-contained)", () => {
    // generateSW inlines the function source into sw.js; it must not close
    // over anything from this module.
    // eslint-disable-next-line no-new-func
    const revived = new Function(`return (${isCacheFirstImageUrl.toString()})`)();
    expect(revived({ url: new URL("https://anima-protocol.com/avatars/korra.jpg") })).toBe(true);
    expect(revived({ url: new URL("https://x.supabase.co/storage/v1/object/sign/b/a.png?token=t") })).toBe(false);
  });
});
