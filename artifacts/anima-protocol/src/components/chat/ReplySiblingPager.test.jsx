import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReplySiblingPager from "./ReplySiblingPager";

const pager = {
  parentIndex: 2,
  total: 3,
  siblings: [
    { key: "a", messages: [{ role: "assistant", content: "first try" }] },
    { key: "b", messages: [{ role: "assistant", content: "second try" }, { role: "user", content: "then this" }] },
  ],
};

describe("ReplySiblingPager", () => {
  it("starts on the live reply and pages back to read-only earlier versions", () => {
    render(<ReplySiblingPager pager={pager} onSwitch={vi.fn()} />);
    expect(screen.getByTestId("reply-sibling-position").textContent).toContain("3 / 3");
    expect(screen.queryByTestId("reply-sibling-preview")).toBeNull();
    fireEvent.click(screen.getByLabelText("Earlier version of this reply"));
    expect(screen.getByTestId("reply-sibling-position").textContent).toContain("2 / 3");
    expect(screen.getByTestId("reply-sibling-preview").textContent).toContain("second try");
    expect(screen.getByTestId("reply-sibling-preview").textContent).toContain("then this");
  });

  it("switches to the shown version", async () => {
    const onSwitch = vi.fn(async () => ({ ok: true }));
    render(<ReplySiblingPager pager={pager} onSwitch={onSwitch} />);
    fireEvent.click(screen.getByLabelText("Earlier version of this reply"));
    fireEvent.click(screen.getByLabelText("Earlier version of this reply"));
    fireEvent.click(screen.getByTestId("reply-sibling-use"));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(2, "a"));
  });

  it("renders nothing without siblings", () => {
    const { container } = render(<ReplySiblingPager pager={null} />);
    expect(container.innerHTML).toBe("");
  });
});
