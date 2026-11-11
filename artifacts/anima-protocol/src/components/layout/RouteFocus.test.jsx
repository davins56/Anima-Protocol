import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import RouteFocus from "./RouteFocus";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let go;
function Nav() {
  go = useNavigate();
  return null;
}

describe("RouteFocus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers skip links and focuses the new page heading after a section change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <Nav />
          <RouteFocus />
          <div className="app-shell-route">
            <Routes>
              <Route path="/settings" element={<h1>Settings</h1>} />
              <Route path="/chat" element={<h1>Chat</h1>} />
            </Routes>
          </div>
        </MemoryRouter>,
      ),
    );
    const links = [...container.querySelectorAll("a")].map((a) => a.textContent);
    expect(links).toEqual(["Skip to main content", "Skip to chat"]);
    await act(async () => {
      go("/chat");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(document.activeElement?.textContent).toBe("Chat");
    expect([...container.querySelectorAll("a")].map((a) => a.textContent)).toContain("Skip to message box");
  });
});
