import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileMock = vi.hoisted(() => vi.fn());
const generateImageMock = vi.hoisted(() => vi.fn());
const updateAnimaMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/base44Client", () => ({
  uploadDataUrl: vi.fn(async (url) => url),
  base44: {
    integrations: {
      Core: {
        UploadFile: uploadFileMock,
        GenerateImage: generateImageMock,
      },
    },
    entities: {
      Anima: {
        update: updateAnimaMock,
      },
    },
  },
}));

import AnimaCustomizer from "./AnimaCustomizer";
import { flushPortraitUpload } from "@/test/flushPortraitUpload";

function renderCustomizer(anima = { id: "a1", name: "Serenity" }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <AnimaCustomizer anima={anima} variant="page" showHeader />,
    );
  });
  return { container, root };
}

describe("AnimaCustomizer leftover reference-photo look", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    generateImageMock.mockReset();
    updateAnimaMock.mockReset();
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/storage/")) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response("not found", { status: 404 });
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers Upload Reference and Generate Look when no reference is stored", () => {
    const { container } = renderCustomizer();
    expect(container.textContent).toMatch(/Upload Reference/);
    expect(container.textContent).toMatch(/Generate Look/);
    expect(container.textContent).not.toMatch(/Generate from Reference/);
  });

  it("shows a stored reference and Generate from Reference", () => {
    const { container } = renderCustomizer({
      id: "a1",
      name: "Serenity",
      look_reference_url: "/api/storage/objects/refs/face.png",
    });
    const img = container.querySelector('img[alt="Look reference"]');
    expect(img?.getAttribute("src")).toBe("/api/storage/objects/refs/face.png");
    expect(container.textContent).toMatch(/Generate from Reference/);
    expect(container.textContent).toMatch(/Change Reference/);
  });

  it("uploads a likeness photo as the look reference, not the avatar", async () => {
    uploadFileMock.mockResolvedValue({
      file_url: "/api/storage/objects/refs/uploaded.png",
    });
    const { container } = renderCustomizer();
    const input = container.querySelector('input[type="file"]');
    const file = new File(["fake"], "face.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushPortraitUpload();

    expect(uploadFileMock).toHaveBeenCalledWith({ file });
    expect(container.querySelector('img[alt="Look reference"]')?.getAttribute("src")).toBe(
      "/api/storage/objects/refs/uploaded.png",
    );
    expect(container.textContent).toMatch(/Generate from Reference/);
  });

  it("persists a data URL when UploadFile returns the MEMORY.md null stub", async () => {
    uploadFileMock.mockResolvedValue({ file_url: null, url: null });
    const { container } = renderCustomizer();
    const input = container.querySelector('input[type="file"]');
    const file = new File(["fake"], "face.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushPortraitUpload();

    const src = container.querySelector('img[alt="Look reference"]')?.getAttribute("src");
    expect(src).toMatch(/^data:/);
    expect(container.textContent).toMatch(/no fetchable file URL|Portrait saved/i);
    expect(container.textContent).toMatch(/Generate from Reference/);
  });
});
