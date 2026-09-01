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
        {
          id: "char-2",
          name: "Tony Stark",
          universe: "Marvel Cinematic Universe",
          category: "scientist",
        },
      ],
      usingBundledSeed: false,
    });
    toastErrorMock.mockReset();
    upsertCharactersMock.mockReset();
  });

  it("keeps a bounded inner scroller that clears the tab bar", () => {
    const { container, root } = renderModal();
    const overlay = container.querySelector('[data-testid="new-session-overlay"]');
    const panel = container.querySelector('[data-testid="new-session-panel"]');
    const scroller = container.querySelector(
      '[data-testid="new-session-character-scroller"]',
    );

    expect(overlay).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(scroller).toBeTruthy();

    expect(overlay.className).toMatch(/fixed inset-0/);
    expect(overlay.className).toMatch(/overflow-hidden/);
    expect(overlay.className).toMatch(/min-h-0/);
    expect(overlay.className).toContain(
      "pb-[calc(var(--tab-bar-height,0px)+1rem)]",
    );

    expect(panel.className).toMatch(/min-h-0/);
    expect(panel.className).toMatch(/max-h-full/);
    expect(panel.className).toMatch(/overflow-hidden/);
    expect(panel.className).not.toMatch(/max-h-\[90vh\]/);
    expect(panel.className).not.toMatch(/h-screen/);

    expect(scroller.className).toMatch(/flex-1/);
    expect(scroller.className).toMatch(/min-h-0/);
    expect(scroller.className).toMatch(/overflow-y-auto/);
    expect(scroller.className).toMatch(/touch-pan-y/);
    expect(scroller.style.WebkitOverflowScrolling).toBe("touch");

    expect(container.querySelector("input")?.placeholder).toMatch(
      /Search characters or universes/,
    );
    expect(container.textContent).toContain("Init");
    expect(container.textContent).toContain("Cancel");
    expect(scroller.contains(buttonByText(container, "Init"))).toBe(false);
    expect(scroller.contains(buttonByText(container, "Cancel"))).toBe(false);
    expect(overlay.contains(buttonByText(container, "Init"))).toBe(true);

    act(() => {
      root.unmount();
      container.remove();
    });
  });

  it("filters the roster from search and still inits the selected character", async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "session-1" });
    const { container, root } = renderModal({ onCreate });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const search = container.querySelector("input");
    expect(search).toBeTruthy();
    expect(container.textContent).toContain("Serenity");
    expect(container.textContent).toContain("Tony Stark");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter.call(search, "tony");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Serenity");
    expect(container.textContent).toContain("Tony Stark");

    await click(buttonByText(container, "Tony Stark"));
    expect(buttonByText(container, "Init")?.disabled).toBe(false);
    await click(buttonByText(container, "Init"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCreate).toHaveBeenCalledWith({
      mode: "solo",
      character_id: "char-2",
      character: expect.objectContaining({ id: "char-2", name: "Tony Stark" }),
      opening_scene: undefined,
    });

    act(() => {
      root.unmount();
      container.remove();
    });
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
      character: expect.objectContaining({ id: "char-1", name: "Serenity" }),
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

  it("maps a store abort on Init to a specific session error, not a generic connection toast", async () => {
    const onCreate = vi.fn().mockRejectedValue(
      Object.assign(new Error("The server took too long to respond. Check your connection or try again in a moment."), {
        code: "timeout",
      }),
    );
    const { container, root } = renderModal({ onCreate });

    await click(buttonByText(container, "Serenity"));
    await click(buttonByText(container, "Init"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Starting the session timed out. The store is reachable — tap Init to try again.",
    );
    expect(container.textContent).toContain("Starting the session timed out");
    expect(container.textContent).toContain("Init");

    act(() => {
      root.unmount();
      container.remove();
    });
  });

  it("upserts a bundled starter without listing the full roster first", async () => {
    loadRosterCharactersMock.mockResolvedValue({
      characters: [
        {
          id: "char-1",
          name: "Serenity",
          universe: "Protocol",
          category: "companion",
          _bundled: true,
        },
      ],
      usingBundledSeed: true,
    });
    upsertCharactersMock.mockResolvedValue({ added: 1, skipped: 0 });
    const onCreate = vi.fn().mockResolvedValue({ id: "session-1" });
    const { container, root } = renderModal({ onCreate });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await click(buttonByText(container, "Serenity"));
    await click(buttonByText(container, "Init"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(upsertCharactersMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "char-1",
          name: "Serenity",
        }),
      ],
      { skipExistingLookup: true },
    );
    expect(onCreate).toHaveBeenCalledWith({
      mode: "solo",
      character_id: "char-1",
      character: expect.objectContaining({ id: "char-1", name: "Serenity" }),
      opening_scene: undefined,
    });

    act(() => {
      root.unmount();
      container.remove();
    });
  });

  it("remaps a bundled seed id to the store id returned by upsert", async () => {
    loadRosterCharactersMock.mockResolvedValue({
      characters: [
        {
          id: "seed_protocol-serenity",
          name: "Serenity",
          universe: "Protocol",
          category: "companion",
          _bundled: true,
        },
      ],
      usingBundledSeed: true,
    });
    upsertCharactersMock.mockResolvedValue({
      added: 1,
      skipped: 0,
      items: [{ id: "char_store_9", name: "Serenity", universe: "Protocol" }],
    });
    const onCreate = vi.fn().mockResolvedValue({ id: "session-1" });
    const { container, root } = renderModal({ onCreate });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await click(buttonByText(container, "Serenity"));
    await click(buttonByText(container, "Init"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCreate).toHaveBeenCalledWith({
      mode: "solo",
      character_id: "char_store_9",
      character: expect.objectContaining({
        id: "char_store_9",
        name: "Serenity",
      }),
      opening_scene: undefined,
    });
    expect(container.textContent).toContain("Init");
    expect(buttonByText(container, "Init")?.disabled).toBe(false);

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
