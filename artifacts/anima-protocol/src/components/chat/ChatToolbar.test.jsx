import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy({}, { get: () => passthrough }),
    AnimatePresence: ({ children }) => children,
  };
});

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { role: "member" } }),
}));

vi.mock("./ChatHeader", () => ({
  default: () => <div data-testid="chat-header-stub">Header</div>,
}));

vi.mock("./TTSControls", () => ({ default: () => null }));
vi.mock("@/components/audio/EmotionalSoundscapeControl", () => ({ default: () => null }));
vi.mock("@/components/voice/VoiceInteractionPanel", () => ({ default: () => null }));
vi.mock("./StoryDocumentUpload", () => ({ default: () => null }));
vi.mock("./CodeRepairConsole", () => ({ default: () => null }));
vi.mock("./ProtocolUpgradeConsole", () => ({ default: () => null }));
vi.mock("./DeviceScanConsole", () => ({ default: () => null }));
vi.mock("./PrivateChatPanel", () => ({ default: () => null }));
vi.mock("@/components/quests/PersistentQuestLog", () => ({ default: () => null }));
vi.mock("@/components/world/WorldBranchingTreeView", () => ({ default: () => null }));
vi.mock("@/components/world/InteractiveWorldMap", () => ({ default: () => null }));
vi.mock("@/components/map/InteractiveRegionalMap", () => ({ default: () => null }));

import ChatToolbar from "./ChatToolbar";

const session = {
  id: "sess-1",
  mode: "solo",
  character_id: "char-1",
  messages: [{ role: "user", content: "hi" }],
};

const characters = [{ id: "char-1", name: "Korra", universe: "Avatar" }];

const noopTts = {
  isEnabled: false,
  isSpeaking: false,
  isSupported: true,
  voices: [],
  selectedVoice: "",
  setSelectedVoice: () => {},
  toggle: () => {},
  stop: () => {},
};

function toolbarProps(overrides = {}) {
  return {
    activeSession: session,
    characters,
    currentMood: "neutral",
    characterEmotions: {},
    inventoryItems: [{ id: "item-1" }],
    serenity: { id: "serenity" },
    showMentalLine: false,
    isReadingStory: false,
    isPlaying: false,
    setIsPlaying: () => {},
    volume: 0.5,
    setVolume: () => {},
    intensity: 0.5,
    currentSoundscape: null,
    tts: noopTts,
    elTTS: { ...noopTts, toggle: () => {} },
    emotionalTTS: { ...noopTts, stop: () => {} },
    onShowInventory: () => {},
    onToggleMentalLine: () => {},
    onReadStory: () => {},
    onStopReadingStory: () => {},
    onShowImageGen: () => {},
    onShowEditModal: () => {},
    onToggleDeepMode: () => {},
    onOpenRecap: () => {},
    onSelectBranch: () => {},
    onCreateBranch: () => {},
    onShowExport: () => {},
    onAvatarClick: () => {},
    ...overrides,
  };
}

/** @type {{ container: HTMLElement, root: ReturnType<typeof createRoot>, clip: HTMLElement }[]} */
let mounted = [];

function renderToolbar(props = {}) {
  const clip = document.createElement("div");
  clip.className = "app-page-fill overflow-hidden";
  clip.style.overflow = "hidden";
  document.body.appendChild(clip);

  const container = document.createElement("div");
  clip.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <ChatToolbar {...toolbarProps(props)} />
      </MemoryRouter>,
    );
  });
  mounted.push({ container, root, clip });
  return { container, root, clip };
}

function onlineButton(container) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Online"),
  );
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

afterEach(() => {
  for (const { root, clip } of mounted) {
    act(() => {
      root.unmount();
    });
    clip.remove();
  }
  mounted = [];
  document.body.innerHTML = "";
});

describe("ChatToolbar Online actions panel", () => {
  it("portals the open menu to document.body outside overflow-hidden chat chrome", async () => {
    const { container, clip } = renderToolbar();
    const trigger = onlineButton(container);
    expect(trigger).toBeTruthy();
    expect(document.querySelector('[data-testid="chat-online-actions-panel"]')).toBeNull();

    await click(trigger);

    const panel = document.querySelector('[data-testid="chat-online-actions-panel"]');
    const backdrop = document.querySelector('[data-testid="chat-online-actions-backdrop"]');
    expect(panel).toBeTruthy();
    expect(backdrop).toBeTruthy();
    expect(clip.contains(panel)).toBe(false);
    expect(clip.contains(backdrop)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    expect(panel.parentElement).toBe(document.body);
    expect(backdrop.className).toContain("z-[1000]");
    expect(panel.className).toContain("z-[1001]");
    expect(backdrop.style.zIndex).toBe("1000");
    expect(panel.style.zIndex).toBe("1001");
    expect(panel.style.position).toBe("fixed");
    expect(panel.textContent).toContain("Inventory");
    expect(panel.textContent).toContain("Mental Line");
    expect(panel.textContent).toContain("Orchestrate");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and backdrop click", async () => {
    const { container } = renderToolbar();
    await click(onlineButton(container));
    expect(document.querySelector('[data-testid="chat-online-actions-panel"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="chat-online-actions-panel"]')).toBeNull();

    await click(onlineButton(container));
    const backdrop = document.querySelector('[data-testid="chat-online-actions-backdrop"]');
    expect(backdrop).toBeTruthy();
    await click(backdrop);
    expect(document.querySelector('[data-testid="chat-online-actions-panel"]')).toBeNull();
  });

  it("keeps nested Session Tools usable by portaling that menu to document.body", async () => {
    const { container, clip } = renderToolbar();
    await click(onlineButton(container));

    const toolsTrigger = Array.from(
      document.querySelectorAll('[data-testid="chat-online-actions-panel"] button'),
    ).find((button) => button.textContent?.includes("Tools"));
    expect(toolsTrigger).toBeTruthy();

    await click(toolsTrigger);

    const nested = document.querySelector('[data-testid="session-tools-menu"]');
    expect(nested).toBeTruthy();
    expect(clip.contains(nested)).toBe(false);
    expect(document.body.contains(nested)).toBe(true);
    expect(nested.textContent).toContain("Quest Log");
  });
});
