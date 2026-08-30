import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  createBranchForSessionMock,
  loadRosterCharactersMock,
  toastErrorMock,
  upsertCharactersMock,
} = vi.hoisted(() => ({
  createBranchForSessionMock: vi.fn(),
  loadRosterCharactersMock: vi.fn(),
  toastErrorMock: vi.fn(),
  upsertCharactersMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      CharacterGroup: {
        list: vi.fn().mockResolvedValue([]),
      },
      ChatSession: {
        list: vi.fn().mockResolvedValue([]),
      },
    },
  },
}));

vi.mock("@/components/templates/StoryTemplateBrowser", () => ({
  default: () => <div />,
}));

vi.mock("@/components/stories/CanonicalStoriesBrowser", () => ({
  default: () => <div />,
}));

vi.mock("@/components/stories/StoryCharacterChooser", () => ({
  default: () => <div />,
}));

vi.mock("@/hooks/useTimelineBranching", () => ({
  useTimelineBranching: () => ({
    createBranchForSession: createBranchForSessionMock,
  }),
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: () => Promise.resolve(),
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: () => {},
}));

vi.mock("@/lib/loadRosterCharacters", () => ({
  getBundledStarterRoster: () => [
    {
      id: "char-1",
      name: "Serenity",
      universe: "Protocol",
      category: "companion",
    },
  ],
  loadRosterCharacters: loadRosterCharactersMock,
}));

vi.mock("@/lib/seedCharacters", () => ({
  upsertCharacters: upsertCharactersMock,
}));

import NewSessionModal from "./NewSessionModal";

function renderModal(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <NewSessionModal
        mode="solo"
        onClose={() => {}}
        onCreate={() => Promise.resolve({ id: "session-1" })}
        {...props}
      />,
    );
  });
  return { container, root };
}

function buttonByText(container, text) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fillTextarea(textarea, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("NewSessionModal", () => {
  beforeEach(() => {
    createBranchForSessionMock.mockReset();
    loadRosterCharactersMock.mockReset();
    loadRosterCharactersMock.mockResolvedValue({
      characters: [
        {
          id: "char-1",
          name: "Serenity",
          universe: "Protocol",
          category: "companion",
        },
      ],
      usingBundledSeed: false,
    });
    toastErrorMock.mockReset();
    upsertCharactersMock.mockReset();
  });

  it("keeps Init open and shows an error when session creation fails", async () => {
    let rejectCreate;
    const onCreate = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject;
        }),
    );
    const onClose = vi.fn();
    const { container, root } = renderModal({ onClose, onCreate });

    await click(buttonByText(container, "Serenity"));
    await fillTextarea(container.querySelector("textarea"), "A neon room hums.");
    await click(buttonByText(container, "Init"));

    expect(onCreate).toHaveBeenCalledWith({
      mode: "solo",
      character_id: "char-1",
      opening_scene: "A neon room hums.",
    });
    expect(container.textContent).toContain("Saving");

    await act(async () => {
      rejectCreate(new Error("Character store API not found"));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Character store API not found");
    expect(container.textContent).toContain("Init");
    expect(onClose).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Character store API not found");

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
