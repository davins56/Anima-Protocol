import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileMock = vi.hoisted(() => vi.fn());
const generateImageMock = vi.hoisted(() => vi.fn());
const updateAnimaMock = vi.hoisted(() => vi.fn());
const updateCharacterMock = vi.hoisted(() => vi.fn());

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
      Character: {
        update: updateCharacterMock,
      },
    },
  },
}));

import AnimaCustomizer from "./AnimaCustomizer";

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
    updateCharacterMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers Upload Photo, Upload Reference, and Generate Look when no reference is stored", () => {
    const { container } = renderCustomizer({
      id: "char-alyndra",
      name: "Alyndra",
      _storeEntity: "Character",
    });
    expect(container.textContent).toMatch(/No avatar yet/);
    expect(container.textContent).toMatch(/Upload Photo/);
    expect(container.textContent).toMatch(/Upload Reference/);
    expect(container.textContent).toMatch(/Generate Look/);
    expect(container.textContent).not.toMatch(/Generate from Reference/);
    expect(container.querySelector('img[alt="Alyndra portrait"]')).toBeNull();
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

  it("exposes vessel layer fields for the same body in Presence and NetBattle", () => {
    const { container } = renderCustomizer();
    expect(container.textContent).toMatch(/Vessel layers/);
    expect(container.textContent).toMatch(/Body · skin/);
    expect(container.textContent).toMatch(/Hair · style/);
    expect(container.textContent).toMatch(/Cloth · robe/);
    expect(container.textContent).toMatch(/Markings · chest/);
    const marking = container.querySelector('input[placeholder="変"]');
    expect(marking?.value).toBe("変");
  });

  it("uploads a likeness photo as the look reference, not the avatar", async () => {
    uploadFileMock.mockResolvedValue({
      file_url: "/api/storage/objects/refs/uploaded.png",
    });
    const { container } = renderCustomizer();
    const input = container.querySelector('input[aria-label="Upload look reference"]');
    const file = new File(["fake"], "face.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadFileMock).toHaveBeenCalledWith({ file });
    expect(container.querySelector('img[alt="Look reference"]')?.getAttribute("src")).toBe(
      "/api/storage/objects/refs/uploaded.png",
    );
    expect(container.querySelector('img[alt="Serenity portrait"]')).toBeNull();
    expect(container.textContent).toMatch(/Generate from Reference/);
  });

  it("uploads a character photo that fills the portrait box", async () => {
    uploadFileMock.mockResolvedValue({
      file_url: "/api/storage/objects/uploads/aelindra.png",
    });
    const { container } = renderCustomizer({
      id: "char-aelindra",
      name: "Aelindra",
      _storeEntity: "Character",
    });
    const input = container.querySelector('input[aria-label="Upload character photo"]');
    const file = new File(["portrait"], "aelindra.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const portrait = container.querySelector('img[alt="Aelindra portrait"]');
    expect(portrait?.getAttribute("src")).toBe(
      "/api/storage/objects/uploads/aelindra.png",
    );
    expect(portrait?.className).toMatch(/object-cover/);
    expect(portrait?.className).toMatch(/w-full/);
    expect(portrait?.className).toMatch(/h-full/);
    expect(container.querySelector('img[alt="Look reference"]')).toBeNull();
    expect(container.textContent).toMatch(/Change Photo/);

    const save = [...container.querySelectorAll("button")].find((b) =>
      /Apply & Save/i.test(b.textContent || ""),
    );
    expect(save).toBeTruthy();
    await act(async () => {
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateCharacterMock).toHaveBeenCalled();
    expect(updateAnimaMock).not.toHaveBeenCalled();
    const [, patch] = updateCharacterMock.mock.calls[0];
    expect(patch.avatar_url).toBe("/api/storage/objects/uploads/aelindra.png");
  });
});
