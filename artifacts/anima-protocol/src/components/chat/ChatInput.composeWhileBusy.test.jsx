import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatInput from "./ChatInput";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/api/base44Client", () => ({
  base44: { integrations: { Core: { UploadFile: vi.fn() } } },
}));
vi.mock("@/api/pdfDocuments", () => ({
  pdfProgressLabel: () => "",
  uploadPdfDocument: vi.fn(),
  deletePdfDocument: vi.fn(),
}));
vi.mock("@/components/pdf/PdfFileChip", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
});

describe("ChatInput while a reply is in flight", () => {
  it("keeps typing and Send available when composeWhileBusy is set", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isLoading composeWhileBusy />);
    const box = screen.getByPlaceholderText(/Ask me anything/i);
    expect(box.disabled).toBe(false);
    fireEvent.change(box, { target: { value: "you there?" } });
    fireEvent.submit(box.closest("form"));
    expect(onSend).toHaveBeenCalledWith({ text: "you there?", attachments: undefined });
  });

  it("stays locked when a reply is in flight and composeWhileBusy is off", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isLoading />);
    const box = screen.getByPlaceholderText(/Ask me anything/i);
    expect(box.disabled).toBe(true);
    fireEvent.submit(box.closest("form"));
    expect(onSend).not.toHaveBeenCalled();
  });
});
