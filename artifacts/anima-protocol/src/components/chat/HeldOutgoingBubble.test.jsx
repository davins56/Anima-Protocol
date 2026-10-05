import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HeldOutgoingBubble from "./HeldOutgoingBubble";
import { HELD_SEND_NOTE } from "@/lib/heldChatSend";

afterEach(() => {
  cleanup();
});

describe("HeldOutgoingBubble", () => {
  it("shows the held text, the waiting note, and cancel", () => {
    const onCancel = vi.fn();
    render(<HeldOutgoingBubble text={"you there?\n\nI miss you"} onCancel={onCancel} />);
    const bubble = screen.getByTestId("held-outgoing");
    expect(bubble.textContent).toContain("you there?");
    expect(bubble.textContent).toContain("I miss you");
    expect(bubble.textContent).toContain(HELD_SEND_NOTE);
    expect(bubble.textContent).not.toMatch(/one reply ahead/i);
    fireEvent.click(screen.getByTestId("held-outgoing-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
