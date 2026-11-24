import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MessageReactions from "./MessageReactions";
import HomeModelOfflineStrip from "./HomeModelOfflineStrip";
import RichPresencePill from "./RichPresencePill";

const msg = { id: "m2", role: "assistant", content: "Hi", character_name: "Lyra", user_reactions: ["❤️"] };

describe("MessageReactions", () => {
  it("shows chosen reactions and removes one on tap", async () => {
    const onReact = vi.fn(async () => ({ ok: true }));
    render(<MessageReactions message={msg} onReact={onReact} companionName="Lyra" />);
    fireEvent.click(screen.getByLabelText("Remove your love reaction"));
    await waitFor(() => expect(onReact).toHaveBeenCalledWith("❤️"));
  });

  it("opens the palette and adds a reaction", async () => {
    const onReact = vi.fn(async () => ({ ok: true }));
    render(<MessageReactions message={{ ...msg, user_reactions: [] }} onReact={onReact} companionName="Lyra" />);
    fireEvent.click(screen.getByLabelText("React to Lyra's reply"));
    fireEvent.click(screen.getByLabelText("fire"));
    await waitFor(() => expect(onReact).toHaveBeenCalledWith("🔥"));
    expect(screen.queryByRole("group", { name: "Reactions" })).toBeNull();
  });

  it("closes the palette on Escape and is inert while disabled", () => {
    const onReact = vi.fn();
    const { rerender } = render(<MessageReactions message={msg} onReact={onReact} />);
    fireEvent.click(screen.getByLabelText("React to her reply"));
    expect(screen.getByRole("group", { name: "Reactions" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Reactions" })).toBeNull();
    rerender(<MessageReactions message={msg} onReact={onReact} disabled />);
    expect(screen.getByLabelText("Remove your love reaction").hasAttribute("disabled")).toBe(true);
  });
});

describe("presence UI", () => {
  it("renders the pill with its kind", () => {
    render(<RichPresencePill presence={{ kind: "typing", label: "Lyra is typing…", detail: null, tone: "busy" }} />);
    expect(screen.getByTestId("rich-presence").getAttribute("data-presence-kind")).toBe("typing");
    expect(screen.getByText("Lyra is typing…")).toBeTruthy();
  });

  it("explains the offline home model and re-checks on request", async () => {
    const onCheckAgain = vi.fn(async () => "offline");
    render(
      <HomeModelOfflineStrip
        presence={{ kind: "home_offline", label: "Home mind offline", detail: "Her home model isn't answering right now.", tone: "warn" }}
        onCheckAgain={onCheckAgain}
      />,
    );
    expect(screen.getByTestId("home-model-offline").textContent).toContain("Her home model isn't answering");
    fireEvent.click(screen.getByText("Check again"));
    await waitFor(() => expect(onCheckAgain).toHaveBeenCalledTimes(1));
  });
});
