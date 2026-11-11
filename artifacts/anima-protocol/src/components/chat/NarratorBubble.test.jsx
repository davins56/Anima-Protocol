import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import NarratorBubble from "./NarratorBubble";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let host;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function render(ui) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(ui));
  return host;
}

describe("NarratorBubble", () => {
  it("shows the scene heading and narration", () => {
    const el = render(
      <NarratorBubble
        message={{ content: "Fog rolls in.\n\nA bell rings.", scene_heading: "Later, at the docks" }}
      />,
    );
    expect(el.textContent).toContain("Later, at the docks");
    expect(el.querySelectorAll("p")).toHaveLength(2);
  });

  it("falls back to a Narrator label and deletes on click", () => {
    const onDelete = vi.fn();
    const el = render(<NarratorBubble message={{ content: "Night falls." }} onDelete={onDelete} />);
    expect(el.textContent).toContain("Narrator");
    act(() => el.querySelector("button").click());
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
