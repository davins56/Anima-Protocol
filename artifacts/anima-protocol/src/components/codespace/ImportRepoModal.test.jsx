import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportRepoModal from "./ImportRepoModal";

describe("ImportRepoModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains folder + zip import", () => {
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
  });

  it("Pull defaults toward davins56/Anima-Protocol on main", () => {
    const onPullRepo = vi.fn();
    render(
      <ImportRepoModal
        open
        variant="pull"
        busy={false}
        error=""
        onClose={() => {}}
        onPickFolder={() => {}}
        onPickZip={() => {}}
        onPullRepo={onPullRepo}
      />,
    );

    expect(screen.getByText(/Pull Repository/i)).toBeTruthy();
    const url = screen.getByPlaceholderText("https://github.com/davins56/Anima-Protocol");
    expect(url.value).toBe("https://github.com/davins56/Anima-Protocol");
    expect(screen.getByLabelText("GitHub branch").value).toBe("main");

    fireEvent.click(screen.getByRole("button", { name: /pull into codespace/i }));
    expect(onPullRepo).toHaveBeenCalledWith({
      owner: "davins56",
      repo: "Anima-Protocol",
      branch: "main",
    });
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
