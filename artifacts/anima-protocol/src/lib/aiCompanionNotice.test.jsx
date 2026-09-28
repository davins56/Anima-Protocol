import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AI_COMPANION_HEADER_LINE,
  AI_COMPANION_NOTICE_TEXT,
  AI_NOTICE_REPEAT_MS,
  chatHistoryForLlm,
  messagesForModel,
  readAiNoticeShownAt,
  shouldShowAiCompanionNotice,
  writeAiNoticeShownAt,
} from "./aiCompanionNotice";
import { useAiCompanionNotice } from "@/hooks/useAiCompanionNotice";
import SystemDisclosure from "@/components/chat/SystemDisclosure";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe("AI companion notice schedule", () => {
  it("shows at the start of a solo or group session when nothing was recorded", () => {
    expect(shouldShowAiCompanionNotice({ lastShownAt: null, serverShownAt: null, now: 5_000 })).toBe(true);
    expect(shouldShowAiCompanionNotice({ now: 5_000 })).toBe(true);
  });

  it("does not repeat before 3 hours", () => {
    const shown = 1_000_000;
    expect(
      shouldShowAiCompanionNotice({
        lastShownAt: shown,
        now: shown + AI_NOTICE_REPEAT_MS - 1,
      }),
    ).toBe(false);
  });

  it("repeats after 3 hours of the same conversation", () => {
    const shown = 1_000_000;
    expect(
      shouldShowAiCompanionNotice({
        lastShownAt: shown,
        now: shown + AI_NOTICE_REPEAT_MS,
      }),
    ).toBe(true);
  });

  it("uses the later of localStorage and the server timestamp", () => {
    const now = 10_000_000;
    const recent = now - 60_000;
    const stale = now - AI_NOTICE_REPEAT_MS - 1;
    expect(shouldShowAiCompanionNotice({ lastShownAt: null, serverShownAt: recent, now })).toBe(false);
    expect(shouldShowAiCompanionNotice({ lastShownAt: stale, serverShownAt: recent, now })).toBe(false);
    expect(shouldShowAiCompanionNotice({ lastShownAt: stale, serverShownAt: stale, now })).toBe(true);
  });

  it("round-trips the last-shown time per conversation", () => {
    const storage = memoryStorage();
    writeAiNoticeShownAt("solo-1", 42, storage);
    writeAiNoticeShownAt("group-2", 99, storage);
    expect(readAiNoticeShownAt("solo-1", storage)).toBe(42);
    expect(readAiNoticeShownAt("group-2", storage)).toBe(99);
    expect(readAiNoticeShownAt("other", storage)).toBeNull();
  });
});

describe("AI companion notice stays out of the model payload", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "system", type: "ai_notice", content: AI_COMPANION_NOTICE_TEXT },
    { role: "assistant", content: "Hello back." },
    {
      role: "system",
      type: "crisis_resource",
      content: "If you're thinking about suicide or self-harm, you can call or text 988 (US, Suicide & Crisis Lifeline) or text HOME to 741741. If you're outside the US, contact local emergency services.",
    },
  ];

  it("strips the notice and the crisis card from history sent to the model", () => {
    const history = chatHistoryForLlm(messages);
    expect(history).toContain("hello");
    expect(history).toContain("Hello back.");
    expect(history).not.toContain(AI_COMPANION_NOTICE_TEXT);
    expect(history).not.toContain("not a human");
    expect(history).not.toContain("741741");
    expect(messagesForModel(messages).some((message) => message.role === "system")).toBe(false);
  });
});

describe("useAiCompanionNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a system notice at session start and another after 3 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const storage = memoryStorage();
    const persist = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    const seen = { current: [] };

    function Host() {
      seen.current = useAiCompanionNotice({
        sessionId: "sess-1",
        persistShownAt: persist,
        storage,
      });
      return null;
    }

    act(() => {
      root.render(<Host />);
    });
    expect(seen.current.map((notice) => notice.placement)).toEqual(["start"]);
    expect(persist).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(AI_NOTICE_REPEAT_MS);
    });
    expect(seen.current.map((notice) => notice.placement)).toEqual(["start", "repeat"]);

    act(() => {
      root.unmount();
    });
  });
});

describe("SystemDisclosure", () => {
  it("renders the notice and crisis card as system rows, not character bubbles", () => {
    const container = document.createElement("div");
    container.style.width = "390px";
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <div>
          <p data-testid="ai-companion-header-line" className="w-full text-base leading-snug">
            {AI_COMPANION_HEADER_LINE}
          </p>
          <SystemDisclosure tone="info" />
          <SystemDisclosure tone="crisis" />
        </div>,
      );
    });
    const notice = container.querySelector('[data-testid="ai-companion-notice"]');
    const card = container.querySelector('[data-testid="crisis-resource-card"]');
    const header = container.querySelector('[data-testid="ai-companion-header-line"]');
    expect(header.textContent).toContain("Companions are AI.");
    expect(notice.getAttribute("role")).toBe("note");
    expect(notice.textContent).toContain(AI_COMPANION_NOTICE_TEXT);
    expect(notice.textContent).toContain("System");
    expect(notice.querySelector("img, button")).toBeNull();
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.textContent).toContain("988");
    expect(card.textContent).toContain("741741");
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("text-base");
    act(() => root.unmount());
    container.remove();
  });
});
