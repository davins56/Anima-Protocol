import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CANONICAL_STORIES } from "@/lib/canonicalStories";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  chatSessionCreateMock,
  loadRosterCharactersMock,
  replaceMessagesMock,
} = vi.hoisted(() => ({
  chatSessionCreateMock: vi.fn(),
  loadRosterCharactersMock: vi.fn(),
  replaceMessagesMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      ChatSession: {
        create: chatSessionCreateMock,
      },
    },
    messages: {
      replace: replaceMessagesMock,
    },
  },
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: () => Promise.resolve(),
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: () => {},
}));

vi.mock("@/lib/loadRosterCharacters", () => ({
  loadRosterCharacters: loadRosterCharactersMock,
}));

import StoryCharacterChooser from "./StoryCharacterChooser";

function renderChooser(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onCreateSession = props.onCreateSession || vi.fn();
  act(() => {
    root.render(
      <StoryCharacterChooser
        onClose={() => {}}
        onCreateSession={onCreateSession}
        {...props}
      />,
    );
  });
  return {
    container,
    root,
    onCreateSession,
  };
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("StoryCharacterChooser", () => {
  const story = CANONICAL_STORIES[0];
  const insertion = story.insertionPoints[0];
  const character = {
    id: "char-1",
    name: "Serenity",
    universe: "Protocol",
  };

  beforeEach(() => {
    chatSessionCreateMock.mockReset();
    chatSessionCreateMock.mockResolvedValue({
      id: "story-sess-1",
      title: "Serenity in The Boy Who Lived",
    });
    replaceMessagesMock.mockReset();
    loadRosterCharactersMock.mockReset();
    loadRosterCharactersMock.mockResolvedValue({ characters: [character] });
  });

  it("creates via createInitChatSession and does not await /messages/replace", async () => {
    let persistResolve;
    const persistPromise = new Promise((resolve) => {
      persistResolve = resolve;
    });
    replaceMessagesMock.mockImplementation(() => persistPromise);

    const { container, root, onCreateSession } = renderChooser({
      initialStory: story,
      initialInsertions: [insertion],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const overlay = document.querySelector(
      '[data-testid="story-character-chooser-overlay"]',
    );
    const charButton = Array.from(overlay.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Serenity"),
    );
    expect(charButton).toBeTruthy();
    await click(charButton);
    await act(async () => {
      await Promise.resolve();
    });

    expect(chatSessionCreateMock).toHaveBeenCalledTimes(1);
    const createBody = chatSessionCreateMock.mock.calls[0][0];
    expect(createBody).toMatchObject({
      mode: "solo",
      character_id: "char-1",
      title: "Serenity in The Boy Who Lived",
      opening_scene: insertion.narrative,
    });
    expect(createBody).not.toHaveProperty("messages");
    expect(onCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "story-sess-1",
        messages: [
          expect.objectContaining({
            role: "assistant",
            character_name: "Narrator",
          }),
        ],
      }),
    );
    expect(replaceMessagesMock).toHaveBeenCalledWith(
      "story-sess-1",
      expect.arrayContaining([
        expect.objectContaining({ character_name: "Narrator" }),
      ]),
    );
    persistResolve([{ id: "m1" }]);
    await persistPromise;

    act(() => {
      root.unmount();
      container.remove();
    });
  });
});
