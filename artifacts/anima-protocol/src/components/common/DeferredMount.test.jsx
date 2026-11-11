import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DeferredMount from "./DeferredMount";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("DeferredMount", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing until first opened, then stays mounted", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const view = (when) => (
      <DeferredMount when={when}>
        <div data-testid="modal">{when ? "open" : "closed"}</div>
      </DeferredMount>
    );
    act(() => root.render(view(false)));
    expect(container.querySelector('[data-testid="modal"]')).toBeNull();
    act(() => root.render(view(true)));
    expect(container.querySelector('[data-testid="modal"]').textContent).toBe("open");
    act(() => root.render(view(false)));
    // Kept mounted so the modal can run its own close animation.
    expect(container.querySelector('[data-testid="modal"]').textContent).toBe("closed");
  });
});
