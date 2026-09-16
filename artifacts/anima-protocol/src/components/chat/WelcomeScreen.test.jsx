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
      ChatSession: {
        list: vi.fn().mockResolvedValue([]),
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

  it("shows an empty Recent Chats state for signed-in users with no sessions", async () => {
    const { container } = renderWelcomeScreen({ sessions: [] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain("Recent Chats");
    expect(container.textContent).toContain("No conversations yet");
    expect(container.textContent).toContain("Create companion");
    expect(container.textContent).toContain("Start a chat");
  });

  it("lists existing sessions so they can be resumed instead of starting a new chat", async () => {
    const { container } = renderWelcomeScreen({
      sessions: [
        {
          id: "sess-9",
          title: "Lumen",
          last_message: "The hall is still empty.",
          updated_date: new Date().toISOString(),
          character_id: "c1",
          mode: "solo",
        },
      ],
      characters: [{ id: "c1", name: "Lumen", avatar_url: "/api/storage/lumen.webp" }],
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.querySelector('[data-testid="recent-chat-sess-9"]')).toBeTruthy();
    expect(container.textContent).toContain("Lumen");
    expect(container.textContent).toContain("The hall is still empty.");
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
