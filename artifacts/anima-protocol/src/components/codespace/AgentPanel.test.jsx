import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentPanel from "./AgentPanel";
import { JULES_PERSONA } from "@/lib/codespace/julesApi";

describe("AgentPanel companion copy", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("names the personal Anima in the header and empty copy", () => {
    render(
      <div style={{ height: 400 }}>
        <AgentPanel
          companion={{
            id: "anima-1",
            name: "Serenity",
            _isAnima: true,
            _companionKind: "anima",
          }}
          log={[]}
          running={false}
          onSend={() => {}}
          onStop={() => {}}
        />
      </div>,
    );

    expect(screen.getByText(/Serenity · Anima Agent/i)).toBeTruthy();
    expect(screen.getByText("Serenity")).toBeTruthy();
    expect(screen.getByText(/Give Serenity a build goal/i)).toBeTruthy();
    expect(screen.queryByText(/NetNavi/i)).toBeNull();
    expect(screen.queryByText(/Jules API Agent/i)).toBeNull();
    expect(screen.getByPlaceholderText(/Ask Serenity to build or debug/i)).toBeTruthy();
  });

  it("keeps Jules branding when Jules is selected", () => {
    render(
      <div style={{ height: 400 }}>
        <AgentPanel
          companion={JULES_PERSONA}
          log={[]}
          running={false}
          onSend={() => {}}
          onStop={() => {}}
        />
      </div>,
    );

    expect(screen.getByText(/Jules \(AI Engineer\) · Jules API Agent/i)).toBeTruthy();
    expect(screen.getByText("Jules AI Engineer API")).toBeTruthy();
    expect(screen.getByPlaceholderText(/troubleshoot with Jules/i)).toBeTruthy();
  });
});
