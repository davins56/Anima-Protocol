import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listPdfDocuments = vi.hoisted(() => vi.fn());
const renamePdfDocument = vi.hoisted(() => vi.fn());
const deletePdfDocument = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/api/pdfDocuments", () => ({
  listPdfDocuments,
  uploadPdfDocument: vi.fn(),
  renamePdfDocument,
  deletePdfDocument,
  pdfProgressLabel: () => "Reading PDF…",
}));

import CompanionLoreFiles from "./CompanionLoreFiles";

function renderLore() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <CompanionLoreFiles characterId="char_1" characterName="Serenity" />,
    );
  });
  return { container, root };
}

describe("CompanionLoreFiles", () => {
  beforeEach(() => {
    listPdfDocuments.mockResolvedValue([
      { id: "doc_1", filename: "world-bible.pdf", pageCount: 12 },
    ]);
    renamePdfDocument.mockResolvedValue({ id: "doc_1", filename: "renamed.pdf" });
    deletePdfDocument.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("lists lore files and can rename or delete them", async () => {
    const { container } = renderLore();
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("world-bible.pdf");
    expect(container.textContent).toContain("12 pages");
    expect(container.querySelector("[data-testid='lore-pdf-upload']")).toBeTruthy();

    const rename = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Rename"),
    );
    await act(async () => {
      rename.click();
    });
    const input = container.querySelector("input[aria-label='New name for world-bible.pdf']");
    expect(input).toBeTruthy();
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    await act(async () => {
      setValue.call(input, "renamed.pdf");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save name"),
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(renamePdfDocument).toHaveBeenCalledWith("doc_1", "renamed.pdf");

    const remove = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Delete",
    );
    await act(async () => {
      remove.click();
    });
    const confirm = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Delete file"),
    );
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(deletePdfDocument).toHaveBeenCalledWith("doc_1");
  });
});
