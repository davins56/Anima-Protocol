import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/base44Client", () => ({
  base44: {
    integrations: {
      Core: {
        UploadFile: uploadFileMock,
      },
    },
  },
}));

import AvatarUploadField from "./AvatarUploadField";

function renderField(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = props.onChange || vi.fn();
  act(() => {
    root.render(
      <AvatarUploadField
        value=""
        onChange={onChange}
        nameHint="Luna"
        {...props}
      />,
    );
  });
  return { container, root, onChange };
}

describe("AvatarUploadField", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders upload control and name initial when empty", () => {
    const { container } = renderField();
    expect(container.textContent).toContain("Custom Avatar");
    expect(container.textContent).toContain("Upload Avatar");
    expect(container.textContent).toContain("L");
  });

  it("shows generate action when onGenerate is provided", () => {
    const onGenerate = vi.fn();
    const { container } = renderField({ onGenerate });
    const generateBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Generate Portrait"),
    );
    expect(generateBtn).toBeTruthy();
    act(() => {
      generateBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("uploads a selected file and reports the stored URL", async () => {
    uploadFileMock.mockResolvedValue({
      file_url: "/api/storage/objects/avatars/luna.png",
    });
    const { container, onChange } = renderField();
    const input = container.querySelector('input[type="file"]');
    const file = new File(["fake"], "luna.png", { type: "image/png" });

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
    expect(onChange).toHaveBeenCalledWith("/api/storage/objects/avatars/luna.png");
  });

  it("clears the current avatar", () => {
    const { container, onChange } = renderField({
      value: "/api/storage/objects/avatars/luna.png",
    });
    const clearBtn = container.querySelector('button[aria-label="Clear avatar"]');
    expect(clearBtn).toBeTruthy();
    act(() => {
      clearBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("");
  });
});
