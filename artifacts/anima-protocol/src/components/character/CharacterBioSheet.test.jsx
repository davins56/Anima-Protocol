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

import CharacterBioSheet from "./CharacterBioSheet";

const sampleCharacter = {
  id: "char_1",
  name: "Korra",
  universe: "Avatar: Legend of Korra",
  category: "warrior",
  status: "online",
  avatar_url: "/seed-avatars/korra.jpg",
  tagline: "Avatar of the age",
  traits: "impulsive, compassionate, resilient",
  personality: "Fiercely passionate and deeply compassionate.",
  backstory: "The Avatar born into the Southern Water Tribe.",
  speaking_style: "Direct, energetic, and unpretentious.",
  creation_method: "ai_prompt",
  is_starter: true,
};

function renderSheet(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = props.onClose || vi.fn();
  act(() => {
    root.render(
      <CharacterBioSheet
        character={sampleCharacter}
        open
        onClose={onClose}
        {...props}
      />,
    );
  });
  return { container, root, onClose };
}

describe("CharacterBioSheet", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders bio sections from character fields", () => {
    const { container } = renderSheet();
    expect(container.textContent).toContain("Bio Sheet");
    expect(container.textContent).toContain("Korra");
    expect(container.textContent).toContain("Biological Makeup");
    expect(container.textContent).toContain("Backstory");
    expect(container.textContent).toContain("Rap Sheet");
    expect(container.textContent).toContain("Uniques & Details");
    expect(container.textContent).toContain("Southern Water Tribe");
    expect(container.textContent).toContain("Behavioral Profile");
    expect(container.textContent).toContain("impulsive");
  });

  it("calls onClose when Close Dossier is pressed", () => {
    const { container, onClose } = renderSheet();
    const closeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Close Dossier"),
    );
    expect(closeBtn).toBeTruthy();
    act(() => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("returns nothing without a character", () => {
    const { container } = renderSheet({ character: null });
    expect(container.textContent).toBe("");
  });
});
