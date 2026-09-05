import { describe, expect, it, vi } from "vitest";
import { downscaleDataUrl } from "./downscaleImage";

describe("downscaleDataUrl", () => {
  it("rejects HEIC data URLs with a visible format error", async () => {
    const OriginalImage = globalThis.Image;
    class FailingImage {
      set src(_value) {
        queueMicrotask(() => this.onerror?.(new Event("error")));
      }
    }
    globalThis.Image = FailingImage;
    try {
      await expect(
        downscaleDataUrl("data:image/heic;base64,AAAA", 512, 0.8),
      ).rejects.toThrow(/HEIC/i);
    } finally {
      globalThis.Image = OriginalImage;
    }
  });

  it("rejects zero-dimension decodes instead of uploading a blank canvas", async () => {
    const OriginalImage = globalThis.Image;
    const createElement = document.createElement.bind(document);
    const canvasSpy = vi.spyOn(document, "createElement");
    class EmptyImage {
      width = 0;
      height = 0;
      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = EmptyImage;
    try {
      await expect(
        downscaleDataUrl("data:image/png;base64,AAAA", 512, 0.8),
      ).rejects.toThrow(/Failed to load image/i);
      expect(canvasSpy).not.toHaveBeenCalledWith("canvas");
    } finally {
      canvasSpy.mockRestore();
      document.createElement = createElement;
      globalThis.Image = OriginalImage;
    }
  });
});
