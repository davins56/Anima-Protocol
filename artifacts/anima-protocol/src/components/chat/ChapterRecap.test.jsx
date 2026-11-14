import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/api/animaClient", () => ({ animaClient: { functions: { invoke } } }));

import ChapterRecap from "./ChapterRecap";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChapterRecap", () => {
  it("does not run a whole-session model recap on every chat open", () => {
    const { container, rerender } = render(<ChapterRecap sessionId="s-1" isVisible />);
    rerender(<ChapterRecap sessionId="s-2" isVisible />);
    expect(invoke).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});
