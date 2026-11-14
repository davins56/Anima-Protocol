import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ logout: mocks.logout }),
}));

vi.mock("@/hooks/useModelTutor", () => ({
  useModelTutor: () => ({ isSteward: false }),
}));

vi.mock("@/api/animaClient", () => ({
  animaClient: {
    entities: {
      ChatSession: { list: async () => [] },
    },
  },
}));

import HomeDock from "./HomeDock";

function renderDock(path = "/chat", props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HomeDock variant="fixed" {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("fixed app dock (chat and other routes)", () => {
  it("renders the new five-tab nav on /chat with Talk active and no old bar labels", () => {
    renderDock("/chat");
    const dock = screen.getByTestId("bottom-tab-bar");
    expect(dock.querySelector("[data-home-dock]")).toBeTruthy();
    expect(within(dock).getByRole("button", { name: "Talk" }).getAttribute("aria-current")).toBe("page");
    expect(within(dock).queryByText("Chat")).toBeNull();
    expect(within(dock).queryByText("Companions")).toBeNull();
    expect(within(dock).queryByText("Memories")).toBeNull();
    expect(within(dock).queryByText("Settings")).toBeNull();
    expect(within(dock).queryByText("Explore")).toBeNull();
    expect(within(dock).queryByText("HOME")).toBeNull();
    expect(screen.queryByTestId("explore-menu")).toBeNull();
  });

  it("marks the correct tab active for each mapped route", () => {
    const cases = [
      ["/chat/s1", "Talk"],
      ["/animas", "People"],
      ["/characters", "People"],
      ["/cyberworld", "World"],
      ["/explore", "World"],
      ["/settings", "You"],
      ["/profile", "You"],
      ["/memories", "Moments"],
      ["/moments/a1", "Moments"],
    ];
    for (const [path, label] of cases) {
      const { unmount } = renderDock(path);
      const dock = screen.getByTestId("bottom-tab-bar");
      expect(within(dock).getByRole("button", { name: label }).getAttribute("aria-current")).toBe("page");
      const others = ["Talk", "People", "World", "You", "Moments"].filter((name) => name !== label);
      for (const name of others) {
        expect(within(dock).getByRole("button", { name }).getAttribute("aria-current")).toBeNull();
      }
      unmount();
    }
  });

  it("opens Explore from World on every screen, including /chat and /explore", () => {
    renderDock("/chat");
    fireEvent.click(screen.getByRole("button", { name: "World" }));
    const menu = screen.getByTestId("explore-menu");
    expect(menu).toBeTruthy();
    expect(within(menu).getByTestId("explore-filter")).toBeTruthy();
    expect(within(menu).getByText("Home")).toBeTruthy();
    expect(within(menu).getByText("NetBattle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "World" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "World" }).getAttribute("aria-expanded")).toBe("true");

    cleanup();
    renderDock("/explore");
    expect(screen.getByRole("button", { name: "World" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "World" }));
    expect(screen.getByTestId("explore-menu")).toBeTruthy();
  });

  it("lists Settings in Explore and navigates to /settings", () => {
    renderDock("/chat");
    fireEvent.click(screen.getByRole("button", { name: "World" }));
    const menu = screen.getByTestId("explore-menu");
    expect(within(menu).getByText("Settings")).toBeTruthy();
    fireEvent.click(within(menu).getByText("Settings"));
    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
  });

  it("marks You active on /settings", () => {
    renderDock("/settings");
    const dock = screen.getByTestId("bottom-tab-bar");
    expect(within(dock).getByRole("button", { name: "You" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("navigates from the dock to the tab roots", () => {
    renderDock("/chat");
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/animas");
    fireEvent.click(screen.getByRole("button", { name: "You" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
    fireEvent.click(screen.getByRole("button", { name: "Moments" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/memories");
  });

  it("does not render the retired full-width six-tab bar markup", () => {
    renderDock("/chat");
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/CHAT[\s\S]{0,40}COMPANIONS[\s\S]{0,40}MEMORIES/);
    expect(document.querySelector(".tab-bar.fixed-bottom-chrome")).toBeTruthy();
  });
});
