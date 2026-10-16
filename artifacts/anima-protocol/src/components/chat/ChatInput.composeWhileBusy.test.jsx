import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearHeldDraftIfUnchanged,
  createComposerGate,
  dropAppliedComposerRestore,
  readHeldDraft,
  writeHeldDraft,
} from "@/lib/heldChatSend";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import ChatInput from "./ChatInput";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/api/base44Client", () => ({
  base44: { integrations: { Core: { UploadFile: vi.fn() } } },
  deleteUploadedFile: vi.fn(),
}));
vi.mock("@/api/pdfDocuments", () => ({
  pdfProgressLabel: () => "",
  uploadPdfDocument: vi.fn(),
  deletePdfDocument: vi.fn(),
  openPdfDocument: vi.fn(),
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

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

function RestoredBusySendHarness({ storage }) {
  const sessionId = "sess";
  const stampRef = useRef(new Map());
  const ownerRef = useRef(0);
  const gateRef = useRef(null);
  if (gateRef.current == null) {
    gateRef.current = createComposerGate({
      onHeldChange(sid, payload) {
        if (payload == null) {
          const savedAt = stampRef.current.get(sid);
          stampRef.current.delete(sid);
          if (savedAt != null) clearHeldDraftIfUnchanged(storage, "user_a", sid, savedAt);
          return;
        }
        const written = writeHeldDraft(storage, "user_a", sid, payload);
        if (written.ok && written.savedAt != null) stampRef.current.set(sid, written.savedAt);
      },
    });
    ownerRef.current = gateRef.current.accept(sessionId, "hello").ownerToken;
  }
  const [restoreDraft, setRestoreDraft] = useState(() => {
    const draft = readHeldDraft(storage, "user_a", sessionId);
    return {
      token: "user_a:sess",
      sessionId,
      savedAt: draft.savedAt,
      text: draft.text,
      attachments: draft.attachments,
      droppedAttachmentCount: draft.droppedAttachmentCount,
    };
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          gateRef.current.release("reply_finished", ownerRef.current);
          gateRef.current.takeHeld(sessionId);
        }}
      >
        Flush
      </button>
      <ChatInput
        isLoading
        composeWhileBusy
        onSend={(message) => {
          gateRef.current.accept(sessionId, message);
        }}
        restoreDraft={restoreDraft}
        onRestoredDraftSettled={(draft) => {
          clearHeldDraftIfUnchanged(storage, "user_a", draft.sessionId, draft.savedAt);
          setRestoreDraft((prev) => dropAppliedComposerRestore(prev, draft));
        }}
      />
    </>
  );
}

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

  it("keeps the held draft when restored text is sent unchanged while she is still replying", () => {
    const storage = memoryStorage();
    writeHeldDraft(storage, "user_a", "sess", "you there?");
    render(<RestoredBusySendHarness storage={storage} />);
    const box = screen.getByPlaceholderText(/Ask me anything/i);
    expect(box.value).toBe("you there?");
    fireEvent.submit(box.closest("form"));
    expect(readHeldDraft(storage, "user_a", "sess")?.text).toBe("you there?");
    fireEvent.click(screen.getByRole("button", { name: "Flush" }));
    expect(readHeldDraft(storage, "user_a", "sess")).toBeNull();
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

  it("accepts a jpeg photo and refuses a gif", async () => {
    toast.error.mockClear();
    base44.integrations.Core.UploadFile.mockClear();
    base44.integrations.Core.UploadFile.mockResolvedValue({
      file_url: "/api/storage/objects/uploads/pic",
    });
    render(<ChatInput onSend={vi.fn()} />);
    const photo = screen.getByLabelText("Attach a photo");
    expect(photo.getAttribute("accept")).toContain("image/*");
    expect(photo.getAttribute("accept")).toContain(".heic");
    expect(photo.hasAttribute("capture")).toBe(false);
    expect(screen.getByLabelText("Attach a PDF").getAttribute("accept")).toContain("pdf");

    const gif = new File([new Uint8Array([1, 2, 3])], "anim.gif", { type: "image/gif" });
    Object.defineProperty(photo, "files", { configurable: true, value: [gif] });
    fireEvent.change(photo);
    expect(toast.error).toHaveBeenCalled();
    expect(base44.integrations.Core.UploadFile).not.toHaveBeenCalled();

    const jpeg = new File([new Uint8Array([1, 2, 3])], "shot.jpg", { type: "image/jpeg" });
    Object.defineProperty(photo, "files", { configurable: true, value: [jpeg] });
    fireEvent.change(photo);
    expect(await screen.findByAltText("preview")).toBeTruthy();
    expect(base44.integrations.Core.UploadFile).toHaveBeenCalledWith({ file: jpeg });
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
