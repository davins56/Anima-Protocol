import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportRepoModal from "./ImportRepoModal";

describe("ImportRepoModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains folder + zip import and points GitHub URLs at Download ZIP", () => {
    render(
      <ImportRepoModal
        open
        busy={false}
        error=""
        onClose={() => {}}
        onPickFolder={() => {}}
        onPickZip={() => {}}
      />,
    );

    expect(screen.getByText(/Import Repository/i)).toBeTruthy();
    expect(screen.getByText(/Choose folder/i)).toBeTruthy();
    expect(screen.getByText(/Choose \.zip/i)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), {
      target: { value: "https://github.com/davins56/Anima-Protocol" },
    });

    expect(screen.getByText(/does not clone from/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /davins56\/Anima-Protocol/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/davins56/Anima-Protocol/archive/refs/heads/main.zip",
    );
  });

  it("surfaces an import error in the HUD", () => {
    render(
      <ImportRepoModal
        open
        busy={false}
        error="Zip is larger than 8MB."
        onClose={vi.fn()}
        onPickFolder={vi.fn()}
        onPickZip={vi.fn()}
      />,
    );
    expect(screen.getByText("Zip is larger than 8MB.")).toBeTruthy();
  });
});
