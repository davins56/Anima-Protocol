import { describe, it, expect, vi } from "vitest";
import {
  resolveApplyTarget,
  canShowApply,
  applyAvatarEdit,
  readPhotoAsDataUrl,
  openPhotoEditor,
} from "./avatarPhoto";

// These guard the pick-a-photo-and-AI-edit avatar flow:
//   - The modal must only offer "Use Photo" (save the untouched original) when
//     the caller opted in (a freshly picked photo), and saving it must downscale
//     the source before handing it back.
//   - MainHome must turn a picked file into a data URL and open the editor wired
//     to that source, marked as a new photo.

describe("resolveApplyTarget (what Apply / Use Photo saves)", () => {
  it("prefers the AI result whenever one exists", () => {
    expect(
      resolveApplyTarget({
        result: "data:image/png;base64,RESULT",
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: true,
      }),
    ).toBe("data:image/png;base64,RESULT");
  });

  it("returns the original source when allowed and there is no AI result", () => {
    expect(
      resolveApplyTarget({
        result: null,
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: true,
      }),
    ).toBe("data:image/png;base64,SRC");
  });

  it("returns null when saving the original is not allowed", () => {
    expect(
      resolveApplyTarget({
        result: null,
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: false,
      }),
    ).toBe(null);
  });

  it("returns null when there is no result and no source", () => {
    expect(
      resolveApplyTarget({
        result: null,
        sourceImage: null,
        allowSaveOriginal: true,
      }),
    ).toBe(null);
  });
});

describe("canShowApply (Apply / Use Photo button visibility)", () => {
  it("shows the button for a freshly picked photo (allowSaveOriginal=true)", () => {
    expect(
      canShowApply({
        result: null,
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: true,
      }),
    ).toBe(true);
  });

  it("hides the button with allowSaveOriginal=false and no AI result", () => {
    expect(
      canShowApply({
        result: null,
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: false,
      }),
    ).toBe(false);
  });

  it("shows the button once an AI result exists, even without allowSaveOriginal", () => {
    expect(
      canShowApply({
        result: "data:image/png;base64,RESULT",
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: false,
      }),
    ).toBe(true);
  });
});

describe("applyAvatarEdit (the Use Photo / Apply action)", () => {
  it("downscales the source image and applies it when saving the original", async () => {
    const downscale = vi.fn(async (src) => `${src}#small`);
    const onApply = vi.fn(async () => {});

    const applied = await applyAvatarEdit(
      {
        result: null,
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: true,
      },
      { onApply, downscale },
    );

    expect(applied).toBe(true);
    // The untouched source is what gets downscaled...
    expect(downscale).toHaveBeenCalledTimes(1);
    expect(downscale).toHaveBeenCalledWith("data:image/png;base64,SRC", 512, 0.85);
    // ...and the downscaled output is what onApply receives.
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith("data:image/png;base64,SRC#small");
  });

  it("downscales the AI result when one exists", async () => {
    const downscale = vi.fn(async (src) => `${src}#small`);
    const onApply = vi.fn(async () => {});

    await applyAvatarEdit(
      {
        result: "data:image/png;base64,RESULT",
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: true,
      },
      { onApply, downscale },
    );

    expect(downscale).toHaveBeenCalledWith("data:image/png;base64,RESULT", 512, 0.85);
    expect(onApply).toHaveBeenCalledWith("data:image/png;base64,RESULT#small");
  });

  it("does nothing (no downscale, no apply) when there is nothing to save", async () => {
    const downscale = vi.fn(async (src) => `${src}#small`);
    const onApply = vi.fn(async () => {});

    const applied = await applyAvatarEdit(
      {
        result: null,
        sourceImage: "data:image/png;base64,SRC",
        allowSaveOriginal: false,
      },
      { onApply, downscale },
    );

    expect(applied).toBe(false);
    expect(downscale).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("readPhotoAsDataUrl (picked file → data URL)", () => {
  it("reads a file into a data URL string", async () => {
    const file = new File(["hello"], "photo.png", { type: "image/png" });
    const dataUrl = await readPhotoAsDataUrl(file);
    expect(typeof dataUrl).toBe("string");
    expect(dataUrl.startsWith("data:image/png")).toBe(true);
  });

  it("resolves null when no file is provided", async () => {
    expect(await readPhotoAsDataUrl(undefined)).toBe(null);
  });
});

describe("openPhotoEditor (MainHome handlePhotoSelected core)", () => {
  it("reads the file, shrinks it for the AI edit, and opens the editor", async () => {
    const setEditSource = vi.fn();
    const setEditingNewPhoto = vi.fn();
    const setAiEditOpen = vi.fn();
    const read = vi.fn(async () => "data:image/png;base64,PICKED");
    // Large phone photos are shrunk to ~1024px before reaching the AI edit.
    const downscale = vi.fn(async (src) => `${src}#1024`);
    const file = new File(["x"], "photo.png", { type: "image/png" });

    const opened = await openPhotoEditor(file, {
      read,
      downscale,
      setEditSource,
      setEditingNewPhoto,
      setAiEditOpen,
    });

    expect(opened).toBe(true);
    expect(read).toHaveBeenCalledWith(file);
    expect(downscale).toHaveBeenCalledWith("data:image/png;base64,PICKED", 1024, 0.85);
    // editSource is set to the shrunk data URL...
    expect(setEditSource).toHaveBeenCalledWith("data:image/png;base64,PICKED#1024");
    // ...the flow is marked as a new photo (enables "Use Photo")...
    expect(setEditingNewPhoto).toHaveBeenCalledWith(true);
    // ...and the modal is opened.
    expect(setAiEditOpen).toHaveBeenCalledWith(true);
  });

  it("falls back to the raw photo when shrinking fails", async () => {
    const setEditSource = vi.fn();
    const setEditingNewPhoto = vi.fn();
    const setAiEditOpen = vi.fn();
    const read = vi.fn(async () => "data:image/png;base64,PICKED");
    const downscale = vi.fn(async () => {
      throw new Error("canvas unavailable");
    });

    const opened = await openPhotoEditor(
      {},
      { read, downscale, setEditSource, setEditingNewPhoto, setAiEditOpen },
    );

    expect(opened).toBe(true);
    expect(setEditSource).toHaveBeenCalledWith("data:image/png;base64,PICKED");
    expect(setAiEditOpen).toHaveBeenCalledWith(true);
  });

  it("end-to-end: a real picked file opens the editor with a data URL source", async () => {
    const setEditSource = vi.fn();
    const setEditingNewPhoto = vi.fn();
    const setAiEditOpen = vi.fn();
    // Pass a passthrough downscale: the real one needs a DOM canvas/image
    // pipeline that jsdom doesn't implement.
    const downscale = vi.fn(async (src) => src);
    const file = new File(["bytes"], "avatar.png", { type: "image/png" });

    const opened = await openPhotoEditor(file, {
      downscale,
      setEditSource,
      setEditingNewPhoto,
      setAiEditOpen,
    });

    expect(opened).toBe(true);
    const source = setEditSource.mock.calls[0][0];
    expect(typeof source).toBe("string");
    expect(source.startsWith("data:image/png")).toBe(true);
    expect(setEditingNewPhoto).toHaveBeenCalledWith(true);
    expect(setAiEditOpen).toHaveBeenCalledWith(true);
  });

  it("does not open the editor when the file can't be read", async () => {
    const setEditSource = vi.fn();
    const setEditingNewPhoto = vi.fn();
    const setAiEditOpen = vi.fn();
    const read = vi.fn(async () => null);
    const downscale = vi.fn(async (src) => src);

    const opened = await openPhotoEditor(
      {},
      { read, downscale, setEditSource, setEditingNewPhoto, setAiEditOpen },
    );

    expect(opened).toBe(false);
    expect(downscale).not.toHaveBeenCalled();
    expect(setEditSource).not.toHaveBeenCalled();
    expect(setEditingNewPhoto).not.toHaveBeenCalled();
    expect(setAiEditOpen).not.toHaveBeenCalled();
  });
});
