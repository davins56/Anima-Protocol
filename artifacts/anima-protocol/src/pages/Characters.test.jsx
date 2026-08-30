import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileMock = vi.hoisted(() => vi.fn());
const createCharacterMock = vi.hoisted(() => vi.fn());
const listCharactersMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    Link: ({ children }) => <a>{children}</a>,
  };
});

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock("@/lib/useStoreSync", () => ({
  useStoreSync: () => {},
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: () => Promise.resolve(),
}));

vi.mock("@/lib/ConfirmDialog", () => ({
  useConfirm: () => async () => false,
}));

vi.mock("@/lib/seedCharacters", () => ({
  autoAssignCharacterPhoto: vi.fn(),
  getStarterRoster: () => [],
  photoNeedsLookup: () => false,
  retryStarterSeed: vi.fn(),
}));

vi.mock("@/components/voice/VoicePicker", () => ({
  default: () => null,
}));

vi.mock("@/components/characters/VoiceCloneManager", () => ({
  default: () => null,
}));

vi.mock("@/components/characters/AddSeriesCharactersModal", () => ({
  default: () => null,
}));

vi.mock("@/components/character/CharacterBioSheet", () => ({
  default: () => null,
}));

vi.mock("@/api/base44Client", () => ({
  notifyStoreChanged: vi.fn(),
  base44: {
    entities: {
      Character: {
        list: listCharactersMock,
        create: createCharacterMock,
        update: vi.fn(),
      },
    },
    integrations: {
      Core: {
        UploadFile: uploadFileMock,
      },
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

import Characters from "./Characters";

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Characters />);
  });
  return { container, root };
}

describe("Characters New Character image upload", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    createCharacterMock.mockReset();
    listCharactersMock.mockReset();
    toastErrorMock.mockReset();
    listCharactersMock.mockResolvedValue([]);
    createCharacterMock.mockImplementation(async (payload) => ({
      id: "char-1",
      ...payload,
    }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("attaches a picked image to the form and persists avatar_url on create", async () => {
    uploadFileMock.mockResolvedValue({
      file_url: "/api/storage/objects/uploads/new-char",
    });

    const { container } = renderPage();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const newBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("New Character"),
    );
    expect(newBtn).toBeTruthy();
    await act(async () => {
      newBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toMatch(/\/\/ New Character/);

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const file = new File(["fake"], "korra.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: [file],
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadFileMock).toHaveBeenCalledWith({ file });
    const preview = container.querySelector('img[alt="avatar"]');
    expect(preview?.getAttribute("src")).toBe(
      "/api/storage/objects/uploads/new-char",
    );

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (el) => el.getAttribute("placeholder") === "e.g. Serenity",
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter.call(nameInput, "Korra");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Create",
    );
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createCharacterMock).toHaveBeenCalled();
    const payload = createCharacterMock.mock.calls[0][0];
    expect(payload.avatar_url).toBe("/api/storage/objects/uploads/new-char");
    expect(payload.name).toBe("Korra");
  });

  it("shows a real error when the upload API fails", async () => {
    uploadFileMock.mockRejectedValue(new Error("Image upload API not found"));

    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const newBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("New Character"),
    );
    await act(async () => {
      newBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["fake"], "korra.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: [file],
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/not available|not found|Upload failed/i);
    expect(container.querySelector('img[alt="avatar"]')).toBeNull();
  });
});
