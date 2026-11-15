import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const authState = { user: { id: "user_clerk123", role: "member" } };

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("./ChatHeader", () => ({
  default: () => <div data-testid="chat-header-stub">Header</div>,
}));

vi.mock("@/components/vessel/VesselPortrait", () => ({
  default: ({ fallback, name }) => fallback || <span>{name}</span>,
}));

vi.mock("./TTSControls", () => ({ default: () => null }));
vi.mock("@/components/audio/EmotionalSoundscapeControl", () => ({ default: () => null }));
vi.mock("@/components/voice/VoiceInteractionPanel", () => ({ default: () => null }));
vi.mock("./StoryDocumentUpload", () => ({ default: () => null }));
vi.mock("./CodeRepairConsole", () => ({ default: () => null }));
vi.mock("./ProtocolUpgradeConsole", () => ({ default: () => null }));
vi.mock("./DeviceScanConsole", () => ({ default: () => null }));

import ChatToolbar from "./ChatToolbar";

const session = {
  id: "sess-1",
  mode: "solo",
  character_id: "char-1",
  title: "Scarlett",
  messages: [{ role: "user", content: "hi" }],
};

const characters = [{ id: "char-1", name: "Scarlett", avatar_url: "" }];

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
    characterEmotions: { "char-1": { emotion: "neutral" } },
    inventoryItems: [],
    serenity: null,
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
    onOpenStage: () => {},
    onOpenHistory: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  authState.user = { id: "user_clerk123", role: "member" };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ChatToolbar collapsible companion header", () => {
  it("collapses to avatar, name, and status and persists the choice", () => {
    render(
      <MemoryRouter>
        <ChatToolbar {...toolbarProps()} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("chat-header-stub")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recent chats" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /stage/i })).toBeTruthy();
    expect(screen.queryByTestId("talk-section-header-summary")).toBeNull();

    const toggle = screen.getByTestId("talk-section-header-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("talk-section-header-panel");
    fireEvent.click(toggle);

    const summary = screen.getByTestId("talk-section-header-summary");
    expect(summary.textContent).toMatch(/Scarlett/);
    expect(summary.textContent).toMatch(/Online/);
    expect(screen.getByTestId("talk-header-summary-feeling").textContent).toMatch(/neutral/i);
    expect(screen.getByTestId("talk-section-header-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("talk-section-header-panel").hidden).toBe(true);
    expect(localStorage.getItem("anima:talk:collapse:user_clerk123:header")).toBe("1");

    cleanup();

    render(
      <MemoryRouter>
        <ChatToolbar {...toolbarProps()} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("talk-section-header-summary").textContent).toMatch(/Scarlett/);
    expect(screen.getByTestId("talk-section-header-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("chat-header-stub")).toBeTruthy();
    expect(document.getElementById("talk-section-header-panel").hidden).toBe(true);

    fireEvent.click(screen.getByTestId("talk-section-header-toggle"));
    expect(screen.getByTestId("talk-section-header-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId("talk-section-header-summary")).toBeNull();
    expect(screen.getByRole("button", { name: /stage/i })).toBeTruthy();
  });
});
