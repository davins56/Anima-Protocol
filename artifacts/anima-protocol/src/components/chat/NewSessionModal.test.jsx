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

function modalEl() {
  return document.querySelector('[data-testid="new-session-overlay"]');
}

function buttonByText(scope, text) {
  const root = scope instanceof HTMLElement ? scope : modalEl() || document;
  return Array.from(root.querySelectorAll("button")).find((button) =>
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

  it("portals a single --app-height scroller that clears the tab bar", () => {
    const { container, root } = renderModal();
    const overlay = modalEl();
    const panel = document.querySelector('[data-testid="new-session-panel"]');
    const roster = document.querySelector(
      '[data-testid="new-session-character-roster"]',
    );

    expect(overlay).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(roster).toBeTruthy();
    expect(overlay.parentElement).toBe(document.body);
    expect(container.contains(overlay)).toBe(false);

    expect(overlay.className).toMatch(/fixed inset-0/);
    expect(overlay.className).toMatch(/overflow-y-scroll/);
    expect(overlay.className).toMatch(/touch-pan-y/);
    expect(overlay.className).toContain("h-app-viewport");
    expect(overlay.className).toContain(
      "pb-[calc(var(--tab-bar-height,0px)+1rem)]",
    );
    expect(overlay.style.height).toBe("var(--app-height, 100dvh)");
    expect(overlay.style.maxHeight).toBe("var(--app-height, 100dvh)");
    expect(overlay.style.WebkitOverflowScrolling).toBe("touch");

    expect(panel.className).not.toMatch(/max-h-\[90vh\]/);
    expect(panel.className).not.toMatch(/overflow-hidden/);
    expect(roster.className).not.toMatch(/overflow-y-auto/);
    expect(overlay.textContent).toContain("Init");
    expect(overlay.textContent).toContain("Cancel");
    expect(overlay.contains(buttonByText(overlay, "Init"))).toBe(true);
    expect(roster.contains(buttonByText(overlay, "Init"))).toBe(false);

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

    const overlay = modalEl();
    const search = overlay.querySelector("input");
    expect(search).toBeTruthy();
    expect(overlay.textContent).toContain("Serenity");
    expect(overlay.textContent).toContain("Tony Stark");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter.call(search, "tony");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(overlay.textContent).not.toContain("Serenity");
    expect(overlay.textContent).toContain("Tony Stark");

    await click(buttonByText(overlay, "Tony Stark"));
    expect(buttonByText(overlay, "Init")?.disabled).toBe(false);
    await click(buttonByText(overlay, "Init"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(onCreate).toHaveBeenCalledWith({
      mode: "solo",
      character_id: "char-2",
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

    await click(buttonByText(modalEl(), "Serenity"));
    await fillTextarea(modalEl().querySelector("textarea"), "A neon room hums.");
    await click(buttonByText(modalEl(), "Init"));

    expect(onCreate).toHaveBeenCalledWith({
      mode: "solo",
      character_id: "char-1",
      opening_scene: "A neon room hums.",
    });
    expect(modalEl().textContent).toContain("Saving");

    await act(async () => {
      rejectCreate(new Error("Character store API not found"));
      await Promise.resolve();
    });

    expect(modalEl().textContent).toContain("Character store API not found");
    expect(modalEl().textContent).toContain("Init");
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

    await click(buttonByText(modalEl(), "Serenity"));
    await click(buttonByText(modalEl(), "Init"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Starting the session timed out. The store is reachable — tap Init to try again.",
    );
    expect(modalEl().textContent).toContain("Starting the session timed out");
    expect(modalEl().textContent).toContain("Init");

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

    await click(buttonByText(modalEl(), "Serenity"));
    await click(buttonByText(modalEl(), "Init"));
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
    expect(onCreate).toHaveBeenCalled();

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
