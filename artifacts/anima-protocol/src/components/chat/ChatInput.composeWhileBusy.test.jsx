import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropAppliedComposerRestore } from "@/lib/heldChatSend";
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

const restoredDraft = {
  token: "user_a:sess-a",
  sessionId: "sess-a",
  savedAt: 1_000,
  text: "you there?",
  attachments: [],
  droppedAttachmentCount: 0,
};

function RestoreSessionHarness() {
  const [sessionId, setSessionId] = useState("sess-a");
  const [composerRestore, setComposerRestore] = useState(restoredDraft);
  return (
    <>
      <button type="button" onClick={() => setSessionId("sess-b")}>
        Other chat
      </button>
      <button type="button" onClick={() => setSessionId("sess-a")}>
        Back
      </button>
      <ChatInput
        key={sessionId}
        sessionId={sessionId}
        onSend={() => {}}
        restoreDraft={composerRestore?.sessionId === sessionId ? composerRestore : null}
        onRestoreDraftApplied={(draft) => {
          setComposerRestore((prev) => dropAppliedComposerRestore(prev, draft));
        }}
      />
    </>
  );
}

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

  it("puts a restored draft in the box and does not send it", () => {
    const onSend = vi.fn();
    const onRestoreDraftApplied = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        restoreDraft={{
          token: "user_a:sess",
          sessionId: "sess",
          text: "you there?",
          attachments: [
            { url: "/api/storage/objects/uploads/pic", type: "image", name: "pic.png" },
          ],
          droppedAttachmentCount: 1,
        }}
        onRestoreDraftApplied={onRestoreDraftApplied}
      />,
    );
    const box = screen.getByPlaceholderText(/Ask me anything/i);
    expect(box.value).toBe("you there?");
    expect(screen.getByAltText("preview")).toBeTruthy();
    expect(screen.getByTestId("held-draft-restored").textContent).toMatch(/back in the box/i);
    expect(screen.getByTestId("held-draft-restored").textContent).toMatch(/attachment wasn't kept/i);
    expect(onSend).not.toHaveBeenCalled();
    expect(onRestoreDraftApplied).toHaveBeenCalledTimes(1);
  });

  it("does not put the restored text back after switching chats and returning", () => {
    render(<RestoreSessionHarness />);
    const box = () => screen.getByPlaceholderText(/Ask me anything/i);
    expect(box().value).toBe("you there?");
    fireEvent.click(screen.getByRole("button", { name: "Other chat" }));
    expect(box().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(box().value).toBe("");
  });

  it("clears the saved copy when the restored text is sent or the box is emptied", () => {
    const onSend = vi.fn();
    const onSettled = vi.fn();
    const { unmount } = render(
      <ChatInput
        onSend={onSend}
        restoreDraft={restoredDraft}
        onRestoredDraftSettled={onSettled}
      />,
    );
    const box = screen.getByPlaceholderText(/Ask me anything/i);
    expect(box.value).toBe("you there?");
    expect(onSettled).not.toHaveBeenCalled();
    fireEvent.submit(box.closest("form"));
    expect(onSend).toHaveBeenCalledWith({ text: "you there?", attachments: undefined });
    expect(onSettled).toHaveBeenCalledWith(restoredDraft);

    onSettled.mockClear();
    unmount();
    render(
      <ChatInput
        onSend={onSend}
        restoreDraft={restoredDraft}
        onRestoredDraftSettled={onSettled}
      />,
    );
    const again = screen.getByPlaceholderText(/Ask me anything/i);
    expect(again.value).toBe("you there?");
    fireEvent.change(again, { target: { value: "" } });
    expect(onSettled).toHaveBeenCalledWith(restoredDraft);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("keeps text the user already typed and appends the restored line", () => {
    const onSend = vi.fn();
    const { rerender } = render(<ChatInput onSend={onSend} />);
    const box = screen.getByPlaceholderText(/Ask me anything/i);
    fireEvent.change(box, { target: { value: "already typing" } });
    rerender(
      <ChatInput
        onSend={onSend}
        restoreDraft={{
          token: "user_a:sess",
          sessionId: "sess",
          text: "you there?",
          attachments: [],
          droppedAttachmentCount: 0,
        }}
      />,
    );
    expect(box.value).toBe("already typing\n\nyou there?");
    expect(onSend).not.toHaveBeenCalled();
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
