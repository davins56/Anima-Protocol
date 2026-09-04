import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { appearsInCheckInList } from "@/lib/sacredSpaceCheckIn";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { meMock, createMock, navigateMock, toastErrorMock } = vi.hoisted(() => ({
  meMock: vi.fn(),
  createMock: vi.fn(),
  navigateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: meMock },
    entities: {
      CheckIn: {
        create: createMock,
        list: vi.fn(),
      },
    },
  },
}));

vi.mock("@/hooks/useCheckInRitual", () => ({
  setGlobalCheckInContext: vi.fn(),
}));

import CheckIn from "./CheckIn";

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <CheckIn />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

describe("Daily Resonance Record Check-in", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    meMock.mockResolvedValue({
      email: "operator@example.com",
      full_name: "Davin Smith",
      selected_mode: "serenity",
    });
    createMock.mockResolvedValue({ id: "ci-1" });
  });

  it("persists a list-visible CheckIn when Record Check-in is tapped with empty notes", async () => {
    await renderPage();

    const button = [...document.querySelectorAll("button")].find((el) =>
      /Record Check-in/i.test(el.textContent || ""),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button.click();
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const body = createMock.mock.calls[0][0];
    expect(appearsInCheckInList(body)).toBe(true);
    expect(body.source).toBe("daily_resonance");
    expect(body.mood).toBe("neutral");
    expect(body.reflection).toMatch(/Daily Resonance/);
  });

  it("saves even when auth.me never resolves — no silent button no-op", async () => {
    meMock.mockReturnValue(new Promise(() => {}));
    await renderPage();

    const button = [...document.querySelectorAll("button")].find((el) =>
      /Record Check-in/i.test(el.textContent || ""),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button.click();
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(appearsInCheckInList(createMock.mock.calls[0][0])).toBe(true);
  });

  it("surfaces a create failure and clears the busy state", async () => {
    createMock.mockRejectedValue(new Error("store 400"));
    await renderPage();

    const button = [...document.querySelectorAll("button")].find((el) =>
      /Record Check-in/i.test(el.textContent || ""),
    );

    await act(async () => {
      button.click();
    });

    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toMatch(/store 400/);
    expect(toastErrorMock).toHaveBeenCalledWith("store 400");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toMatch(/Record Check-in/);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
