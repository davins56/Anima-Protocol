import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, memo } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const renders = new Map();
vi.mock("./MessageBubble", () => ({
  // Same memo boundary as the real bubble; counts renders per message.
  default: memo(function FakeBubble({ message, onRewind }) {
    renders.set(message.content, (renders.get(message.content) || 0) + 1);
    return (
      <button type="button" data-testid="bubble" onClick={onRewind}>
        {message.content}
      </button>
    );
  }),
}));
vi.mock("./SystemDisclosure", () => ({ default: () => null }));

import MessageList, { PAGE_SIZE } from "./MessageList";

function mount(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (next) => act(() => root.render(<MessageList characters={[]} session={{ id: "s1", mode: "solo" }} {...next} />));
  render(props);
  return { container, render };
}

const rows = (n, from = 0) =>
  Array.from({ length: n }, (_, k) => ({
    id: `m${from + k}`,
    seq: from + k,
    role: k % 2 ? "assistant" : "user",
    content: `msg ${from + k}`,
  }));

const bubbles = (c) => [...c.querySelectorAll('[data-testid="bubble"]')].map((b) => b.textContent);
const loadButton = (c) => [...c.querySelectorAll("button")].find((b) => /Previous|Earlier/.test(b.textContent));

describe("MessageList", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    renders.clear();
  });

  it("builds only the visible window, then reveals loaded rows without a delay", () => {
    const messages = rows(50);
    const { container } = mount({ messages, onRewindToMessage: () => {}, onSpeak: () => {} });
    expect(bubbles(container)).toHaveLength(PAGE_SIZE);
    expect(bubbles(container)[0]).toBe("msg 30");
    expect(renders.has("msg 0")).toBe(false);
    act(() => loadButton(container).click());
    expect(bubbles(container)).toHaveLength(PAGE_SIZE * 2);
  });

  it("re-renders only the streaming bubble as tokens arrive", () => {
    const base = rows(5);
    const onRewind = vi.fn();
    const { render } = mount({ messages: [...base, { role: "assistant", content: "par", is_streaming: true }], onRewindToMessage: onRewind, onSpeak: () => {} });
    const before = renders.get("msg 1");
    // A new parent closure each render, like Chat.jsx's inline handlers.
    render({ messages: [...base, { role: "assistant", content: "part", is_streaming: true }], onRewindToMessage: (i) => onRewind(i), onSpeak: () => {} });
    render({ messages: [...base, { role: "assistant", content: "partial", is_streaming: true }], onRewindToMessage: (i) => onRewind(i), onSpeak: () => {} });
    expect(renders.get("msg 1")).toBe(before);
    expect(renders.get("partial")).toBe(1);
  });

  it("stable callbacks still call the latest handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const base = rows(3);
    const { container, render } = mount({ messages: base, onRewindToMessage: first, onSpeak: () => {} });
    render({ messages: base, onRewindToMessage: second, onSpeak: () => {} });
    act(() => container.querySelectorAll('[data-testid="bubble"]')[0].click());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(0);
  });

  it("pages older history from the server with before_seq once local rows run out", async () => {
    const messages = rows(10, 200);
    const onLoadOlder = vi.fn().mockResolvedValue({ fetched: 50, exhausted: false });
    const { container } = mount({ messages, onLoadOlder, onRewindToMessage: () => {}, onSpeak: () => {} });
    expect(loadButton(container).textContent).toMatch(/Earlier/);
    await act(async () => loadButton(container).click());
    expect(onLoadOlder).toHaveBeenCalledWith(200);
  });

  it("hides the button when the thread starts at seq 0", () => {
    const { container } = mount({ messages: rows(10), onLoadOlder: vi.fn(), onRewindToMessage: () => {}, onSpeak: () => {} });
    expect(loadButton(container)).toBeUndefined();
  });
});
