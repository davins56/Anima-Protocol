import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy(
      {},
      {
        get: () => passthrough,
      },
    ),
    AnimatePresence: ({ children }) => children,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: {
      me: vi.fn().mockResolvedValue({ full_name: "John Doe", email: "john@example.com" }),
      redirectToLogin: vi.fn(),
    },
    entities: {
      Anima: {
        list: vi.fn().mockResolvedValue([
          { id: "a1", name: "Serenity", tagline: "Guide of the Protocol", assigned_user: "john@example.com" },
        ]),
      },
    },
    integrations: {
      Core: {
        InvokeLLM: vi.fn().mockResolvedValue("Dynamic greeting test"),
      },
    },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
}));

import WelcomeScreen from "./WelcomeScreen";

describe("WelcomeScreen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function renderWelcomeScreen(props = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onNewSession = props.onNewSession || vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
          <WelcomeScreen onNewSession={onNewSession} {...props} />
        </MemoryRouter>
      );
    });
    return { container, root, onNewSession };
  }

  it("renders companion name and action buttons", async () => {
    const { container } = renderWelcomeScreen();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain("SERENITY.AI");
    expect(container.textContent).toContain("+ Initialize Session");
    expect(container.textContent).toContain("Design Companion");
  });

  it("opens CreateCompanionModal in Design Your Companion mode when Design Companion is clicked", async () => {
    const { container } = renderWelcomeScreen();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const designBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Design Companion")
    );
    expect(designBtn).toBeTruthy();

    act(() => {
      designBtn.click();
    });

    expect(container.textContent).toContain("Design Your Companion");
  });
});
