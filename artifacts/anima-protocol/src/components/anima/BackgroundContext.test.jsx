import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const client = vi.hoisted(() => ({
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  filter: vi.fn(),
  remove: vi.fn(),
  invoke: vi.fn(),
  upload: vi.fn(),
  kgFilter: vi.fn(),
}));

vi.mock("@/api/animaClient", () => ({
  animaClient: {
    auth: { me: client.me },
    entities: {
      UserContext: {
        create: client.create,
        update: client.update,
        filter: client.filter,
        delete: client.remove,
      },
      KnowledgeGraph: { filter: client.kgFilter },
    },
    functions: { invoke: client.invoke },
    integrations: { Core: { UploadFile: client.upload } },
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const strip = ({ initial, animate, exit, transition, whileHover, whileTap, layout, ...rest }) => rest;
  const make = (tag) =>
    ReactMod.forwardRef((props, ref) => ReactMod.createElement(tag, { ref, ...strip(props) }));
  return {
    motion: new Proxy({}, { get: (_, tag) => make(tag) }),
    AnimatePresence: ({ children }) => ReactMod.createElement(ReactMod.Fragment, null, children),
  };
});

import UserContextUploadModal from "./UserContextUploadModal";
import UserContextPanel from "./UserContextUpload";
import UserContextSettings from "./UserContextSettings";
import KnowledgeGraphViewer from "./KnowledgeGraphViewer";

function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function pickFile(input, file) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(container, text) {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent || "").trim().startsWith(text),
  );
}

beforeEach(() => {
  client.me.mockResolvedValue({ email: "u@example.com" });
  client.create.mockImplementation(async (data) => ({ id: "ctx_new", ...data }));
  client.update.mockResolvedValue({});
  client.filter.mockResolvedValue([]);
  client.kgFilter.mockResolvedValue([]);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Background upload modal", () => {
  it("blocks a PDF with a clear message and never saves a card", async () => {
    const onClose = vi.fn();
    const { container } = mount(
      <UserContextUploadModal isOpen onClose={onClose} onUploadComplete={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='user-context-file']");
    expect(input.getAttribute("accept")).not.toContain(".pdf");
    pickFile(input, new File(["%PDF-1.7"], "the-slipthk-way-TRADE.pdf", { type: "application/pdf" }));
    expect(container.querySelector("[role='alert']").textContent).toMatch(
      /PDFs can't be read here yet.*new upload pipeline/,
    );
    expect(button(container, "Upload").disabled).toBe(true);
    expect(client.create).not.toHaveBeenCalled();
    expect(client.invoke).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("waits for analysis, shows the failure instead of closing, and retries the same card", async () => {
    const onClose = vi.fn();
    const onUploadComplete = vi.fn();
    client.invoke.mockRejectedValueOnce(
      Object.assign(new Error("The analysis didn't finish because the model call failed. Try again."), {
        status: 502,
        code: "analysis_failed",
      }),
    );
    const { container } = mount(
      <UserContextUploadModal isOpen onClose={onClose} onUploadComplete={onUploadComplete} />,
    );
    pickFile(
      container.querySelector("[data-testid='user-context-file']"),
      new File(["My essay about courage."], "essay.txt", { type: "text/plain" }),
    );
    await act(async () => {
      button(container, "Upload").click();
    });
    await flush();

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create.mock.calls[0][0]).toMatchObject({
      source_kind: "text",
      file_name: "essay.txt",
      processing_complete: false,
    });
    const [name, payload, options] = client.invoke.mock.calls[0];
    expect(name).toBe("processUserContext");
    expect(payload).toMatchObject({
      user_context_id: "ctx_new",
      file_content: "My essay about courage.",
      is_pdf: false,
    });
    expect(options).toMatchObject({ throwOnError: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']").textContent).toMatch(
      /Saved, but the analysis failed: The analysis didn't finish because the model call failed/,
    );
    // The server recorded this failure itself; the client doesn't overwrite it.
    expect(client.update).not.toHaveBeenCalled();

    client.invoke.mockResolvedValueOnce({ data: { word_count: 4 } });
    await act(async () => {
      button(container, "Retry analysis").click();
    });
    await flush();
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.invoke).toHaveBeenCalledTimes(2);
    expect(client.invoke.mock.calls[1][1].user_context_id).toBe("ctx_new");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only after the analysis succeeds", async () => {
    const onClose = vi.fn();
    client.invoke.mockResolvedValueOnce({ data: { word_count: 2 } });
    const { container } = mount(
      <UserContextUploadModal isOpen onClose={onClose} onUploadComplete={vi.fn()} />,
    );
    pickFile(
      container.querySelector("[data-testid='user-context-file']"),
      new File(["two words"], "n.md", { type: "text/markdown" }),
    );
    await act(async () => {
      button(container, "Upload").click();
    });
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Background document cards", () => {
  const stuck = (id, title) => ({
    id,
    title,
    document_type: "novel",
    file_url: "",
    is_active: true,
    processing_complete: false,
    created_date: "2026-11-09T22:10:00.000Z",
  });

  it("shows the three stuck novels as No text received, not in progress forever", async () => {
    client.filter.mockResolvedValue([
      stuck("a", "the-slipthk-way-TRADE"),
      stuck("b", "Fallen Angel"),
      stuck("c", "Third Book"),
    ]);
    const { container } = mount(<UserContextPanel />);
    await flush();
    const cards = container.querySelectorAll("[data-testid='user-context-card']");
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.getAttribute("data-status")).toBe("no_text");
      expect(card.textContent).toContain("No text received, re-upload when book uploads are available.");
      expect(card.textContent).toContain("no text received");
      expect(card.textContent).not.toContain("AI analysis in progress");
      expect(card.textContent).not.toContain("0 words");
      expect(button(card, "Retry")).toBeUndefined();
    }
  });

  it("shows Failed with the reason and retries on the server from the stored excerpt", async () => {
    client.filter.mockResolvedValue([
      {
        id: "t1",
        title: "Essay",
        document_type: "essay",
        is_active: true,
        source_kind: "text",
        analysis_input: "stored excerpt",
        word_count: 2500,
        processing_complete: false,
        processing_status: "failed",
        processing_error: { code: "analysis_failed", message: "The analysis didn't finish because the model call failed. Try again." },
      },
    ]);
    client.invoke.mockResolvedValueOnce({ data: {} });
    const { container } = mount(<UserContextPanel />);
    await flush();
    const card = container.querySelector("[data-testid='user-context-card']");
    expect(card.getAttribute("data-status")).toBe("failed");
    expect(card.textContent).toContain("Failed: The analysis didn't finish because the model call failed.");
    expect(card.textContent).toContain("2,500 words");
    await act(async () => {
      button(card, "Retry").click();
    });
    await flush();
    const [name, payload, options] = client.invoke.mock.calls[0];
    expect(name).toBe("processUserContext");
    expect(payload).toMatchObject({ user_context_id: "t1", file_content: "" });
    expect(options).toMatchObject({ throwOnError: true });
  });

  it("shows a real word count and says when the summary was truncated", async () => {
    client.filter.mockResolvedValue([
      {
        id: "r1",
        title: "Long Story",
        document_type: "novel",
        is_active: true,
        source_kind: "text",
        processing_complete: true,
        processing_status: "complete",
        extracted_summary: "A long story.",
        word_count: 48210,
        analysis_truncated: true,
        analyzed_char_count: 12000,
        source_char_count: 260512,
      },
    ]);
    const { container } = mount(<UserContextPanel />);
    await flush();
    const card = container.querySelector("[data-testid='user-context-card']");
    expect(card.getAttribute("data-status")).toBe("ready");
    expect(card.textContent).toContain("48,210 words");
    expect(card.textContent).toContain("Summary covers only the first 12,000 of 260,512 characters.");
  });
});

describe("Background screen copy", () => {
  it("says plainly that Background documents are not used in chat yet", async () => {
    const { container } = mount(<UserContextSettings />);
    await flush();
    const notice = container.querySelector("[data-testid='user-context-chat-notice']");
    expect(notice.textContent).toMatch(/not yet used in chat/);
    expect(container.textContent).not.toMatch(/give the Anima deeper context/);
  });

  it("Knowledge Graph no longer claims documents build it", async () => {
    const { container } = mount(<KnowledgeGraphViewer />);
    await flush();
    expect(container.textContent).not.toMatch(/Upload documents to build the knowledge graph/);
    expect(container.textContent).toMatch(/Background documents aren't part of the graph/);
  });
});
