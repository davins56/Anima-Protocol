import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import FileExplorer from "./FileExplorer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe("FileExplorer upload actions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes Upload files and Import repository controls", () => {
    const onUploadFiles = vi.fn();
    const onImportRepo = vi.fn();
    const onPullRepo = vi.fn();
    const { container } = render(
      <FileExplorer
        files={[{ path: "index.html", content: "<h1>hi</h1>" }]}
        activePath="index.html"
        onSelect={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
        onRestoreSession={() => {}}
        onSaveSession={() => {}}
        onUploadFiles={onUploadFiles}
        onImportRepo={onImportRepo}
        onPullRepo={onPullRepo}
      />,
    );

    const upload = container.querySelector('[aria-label="Upload files"]');
    const importRepo = container.querySelector('[aria-label="Import repository"]');
    const pullRepo = container.querySelector('[aria-label="Pull a GitHub repo"]');
    expect(upload).toBeTruthy();
    expect(importRepo).toBeTruthy();
    expect(pullRepo).toBeTruthy();
    expect(container.querySelector('[data-testid="codespace-upload-files"]')).toBeTruthy();

    act(() => {
      importRepo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onImportRepo).toHaveBeenCalledTimes(1);
    act(() => {
      pullRepo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPullRepo).toHaveBeenCalledTimes(1);
  });

  it("shows the empty-state CTA when there are no workspace files", () => {
    const { container } = render(
      <FileExplorer
        files={[]}
        activePath=""
        onSelect={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
        onRestoreSession={() => {}}
        onSaveSession={() => {}}
        onUploadFiles={() => {}}
        onImportRepo={() => {}}
        onPullRepo={() => {}}
      />,
    );
    expect(container.textContent).toMatch(/Upload, Import, or Pull a repo/);
  });
});
