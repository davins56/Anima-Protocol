import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: mocks.me },
    entities: { CheckIn: { create: mocks.create } },
  },
}));

import CheckIn from "./CheckIn";

function renderPage() {
  return render(
    <MemoryRouter>
      <CheckIn />
    </MemoryRouter>,
  );
}

describe("CheckIn viewport layout", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me.mockResolvedValue({
      email: "operator@example.com",
      full_name: "Operator",
      selected_mode: "serenity",
    });
  });

  it("puts the form and Record Check-in action in a vertical scroller", async () => {
    const { container } = renderPage();
    expect(await screen.findByText(/Daily Resonance Check-in/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: /Record Check-in/i });
    expect(submit).toBeTruthy();
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).toBeTruthy();
    expect(scroller.contains(submit)).toBe(true);
    expect(scroller.contains(screen.getByPlaceholderText(/What's happening/i))).toBe(true);
  });
});
