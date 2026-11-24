import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToolActionCard from "./ToolActionCard";
import { applyToolFrame } from "@/lib/tools/toolFrames";

function actionFrom(frames: unknown[]) {
  let m = {};
  for (const f of frames) m = applyToolFrame(m, f);
  return Object.values(m)[0] as Parameters<typeof ToolActionCard>[0]["action"];
}

const base = { action_id: "a1", tool: "webhook", turn_id: "t", user_message_id: "t:user" };

describe("ToolActionCard", () => {
  it("shows the exact request and amount, and sends confirm/deny", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();
    const action = actionFrom([
      {
        ...base,
        event: "confirmation_required",
        seq: 1,
        summary: "Call your webhook",
        confirmation: {
          id: "c1",
          action_kind: "purchase",
          expires_at: "2999-01-01T00:00:00Z",
          request_hash: "h",
          target: "shop.example",
          payload_summary: "Order: 1 × tea",
          amount: 9.99,
          currency: "USD",
        },
      },
    ]);
    render(<ToolActionCard action={action} onConfirm={onConfirm} onDeny={onDeny} onStop={vi.fn()} />);
    expect(screen.getByTestId("tool-payload-summary").textContent).toBe("Order: 1 × tea");
    expect(screen.getByTestId("tool-amount").textContent).toContain("9.99");
    expect(screen.queryByTestId("tool-stop")).toBeNull();
    fireEvent.click(screen.getByTestId("tool-confirm"));
    fireEvent.click(screen.getByTestId("tool-deny"));
    expect(onConfirm).toHaveBeenCalledWith("a1");
    expect(onDeny).toHaveBeenCalledWith("a1");
  });

  it("offers Stop while running and lists numbered sources when done", () => {
    const onStop = vi.fn();
    const running = actionFrom([{ ...base, tool: "web_search", event: "started", seq: 1 }]);
    const { rerender } = render(
      <ToolActionCard action={running} onConfirm={vi.fn()} onDeny={vi.fn()} onStop={onStop} />,
    );
    fireEvent.click(screen.getByTestId("tool-stop"));
    expect(onStop).toHaveBeenCalledWith("a1");
    const done = actionFrom([
      { ...base, tool: "web_search", event: "started", seq: 1 },
      {
        ...base,
        tool: "web_search",
        event: "succeeded",
        seq: 2,
        result: { sources: [{ id: "s1", title: "Tea guide", url: "https://tea.example/g", snippet: "Steep 3 min" }] },
      },
    ]);
    rerender(<ToolActionCard action={done} onConfirm={vi.fn()} onDeny={vi.fn()} onStop={onStop} />);
    expect(screen.queryByTestId("tool-stop")).toBeNull();
    const link = screen.getByText("Tea guide") as HTMLAnchorElement;
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByTestId("tool-sources").textContent).toContain("[1]");
  });
});
