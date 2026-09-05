import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy(
      {},
      {
        get: () => passthrough,
      },
    ),
    AnimatePresence: ({ children }) => children,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Anima: {
        create: vi.fn().mockResolvedValue({ id: "anima_1", name: "Atlas" }),
      },
    },
    auth: {
      me: vi.fn().mockResolvedValue({ email: "user@test.com" }),
    },
  },
}));

import CreateCompanionModal from "./CreateCompanionModal";
import { base44 } from "@/api/base44Client";

describe("CreateCompanionModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function renderModal(props = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onComplete = props.onComplete || vi.fn();
    const onClose = props.onClose || vi.fn();
    act(() => {
      root.render(
        <CreateCompanionModal
          onComplete={onComplete}
          onClose={onClose}
          {...props}
        />
      );
    });
    return { container, root, onComplete, onClose };
  }

  it("renders welcome step by default and navigates to details step", () => {
    const { container } = renderModal();
    expect(container.textContent).toContain("Welcome");
    expect(container.textContent).toContain("Create your first AI companion");

    const createBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create Companion")
    );
    expect(createBtn).toBeTruthy();

    act(() => {
      createBtn.click();
    });

    expect(container.textContent).toContain("Design Your Companion");
  });

  it("renders Design Your Companion screen directly when initialStep='details'", () => {
    const { container } = renderModal({ initialStep: "details" });
    expect(container.textContent).toContain("Design Your Companion");
    expect(container.textContent).toContain("Companion Name");
    expect(container.textContent).toContain("Archetype");
  });

  it("creates companion when name is provided and Create Companion is clicked", async () => {
    const { container } = renderModal({ initialStep: "details" });
    const nameInput = container.querySelector("input[placeholder*='Luna']");
    expect(nameInput).toBeTruthy();

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      nativeInputValueSetter.call(nameInput, "Atlas");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const createBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Create Companion")
    );
    expect(createBtn).toBeTruthy();

    await act(async () => {
      createBtn.click();
    });

    expect(base44.entities.Anima.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Atlas",
        archetype: "Muse",
      })
    );
  });

  it("triggers onClose when close button is clicked", () => {
    const { container, onClose } = renderModal({ initialStep: "details" });
    const closeBtn = container.querySelector("button[aria-label='Close']");
    expect(closeBtn).toBeTruthy();

    act(() => {
      closeBtn.click();
    });

    expect(onClose).toHaveBeenCalled();
  });
});
