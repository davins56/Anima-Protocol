import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileMock = vi.hoisted(() => vi.fn());
const updateMeMock = vi.hoisted(() => vi.fn());
const meMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    logout: vi.fn(),
    isAuthenticated: true,
    user: { email: "operator@example.com" },
  }),
}));

vi.mock("@/api/base44Client", () => ({
  exportData: vi.fn(),
  base44: {
    auth: {
      me: meMock,
      updateMe: updateMeMock,
    },
    entities: {
      Anima: { list: listMock },
      ChatSession: { list: listMock },
      Character: { list: listMock, filter: listMock },
      ResonanceProfile: { list: listMock },
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

vi.mock("@/components/anima/UserContextSettings", () => ({
  default: () => <div>User context settings</div>,
}));
vi.mock("@/components/anima/DeviceScanPanel", () => ({
  default: () => <div>Device scan</div>,
}));
vi.mock("@/components/anima/KnowledgeGraphViewer", () => ({
  default: () => <div>Knowledge graph</div>,
}));
vi.mock("@/components/settings/ProactiveMessageSettings", () => ({
  default: () => <div>Proactive messages</div>,
}));
vi.mock("@/components/onboarding/TutorialOverlay", () => ({
  resetTutorial: vi.fn(),
}));
vi.mock("@/lib/undoableDelete", () => ({
  deleteAllWithUndo: vi.fn(),
}));
vi.mock("@/lib/seedCharacters", () => ({
  repairStarterCharacters: vi.fn(),
}));
vi.mock("@/lib/restoreHandlers", () => ({
  performRestoreFlow: vi.fn(),
}));

import Settings from "./Settings";

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Settings />);
  });
  return { container, root };
}

async function openCustomBackground(container) {
  const interfaceBtn = Array.from(container.querySelectorAll("button")).find(
    (btn) => btn.textContent?.includes("Interface"),
  );
  expect(interfaceBtn).toBeTruthy();
  await act(async () => {
    interfaceBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const customBtn = Array.from(container.querySelectorAll("button")).find(
    (btn) =>
      (btn.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() ===
      "custom",
  );
  expect(customBtn).toBeTruthy();
  await act(async () => {
    customBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Settings custom chat background upload", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    updateMeMock.mockReset();
    meMock.mockReset();
    listMock.mockReset();
    toastErrorMock.mockReset();
    meMock.mockResolvedValue({
      email: "operator@example.com",
      settings: { chat_bg_theme: "default", chat_bg_image: "" },
    });
    listMock.mockResolvedValue([]);
    updateMeMock.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uploads an image, shows the storage preview, and persists settings", async () => {
    uploadFileMock.mockResolvedValue({
      file_url: "/api/storage/objects/uploads/bg-ok",
    });
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await openCustomBackground(container);

    const input = container.querySelector('input[type="file"][accept="image/*"]');
    expect(input).toBeTruthy();
    const file = new File(["fake"], "wallpaper.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadFileMock).toHaveBeenCalledWith({ file });
    expect(updateMeMock).toHaveBeenCalled();
    const saved = updateMeMock.mock.calls[0][0];
    expect(saved.settings.chat_bg_image).toBe("/api/storage/objects/uploads/bg-ok");
    expect(saved.settings.chat_bg_theme).toBe("custom");
    const preview = container.querySelector('img[alt="bg preview"]');
    expect(preview?.getAttribute("src")).toBe("/api/storage/objects/uploads/bg-ok");
    expect(container.textContent).not.toMatch(/Uploading\.\.\./);
  });

  it("shows a visible error and unsticks Uploading... when upload fails", async () => {
    uploadFileMock.mockRejectedValue(new Error("Sign in to upload an image, then try again."));
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await openCustomBackground(container);

    const input = container.querySelector('input[type="file"][accept="image/*"]');
    const file = new File(["fake"], "wallpaper.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/sign in/i);
    expect(container.textContent).not.toMatch(/Uploading\.\.\./);
    expect(updateMeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it("toasts a Hyperdrive reset instead of leaving Uploading stuck", async () => {
    uploadFileMock.mockRejectedValue(
      Object.assign(new Error("Database connection reset"), {
        status: 503,
        reason: "reset",
      }),
    );
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await openCustomBackground(container);

    const input = container.querySelector('input[type="file"][accept="image/*"]');
    const file = new File(["fake"], "wallpaper.png", { type: "image/png" });

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /dropped the upload connection|try again/i,
    );
    expect(container.textContent).not.toMatch(/Uploading\.\.\./);
    expect(toastErrorMock).toHaveBeenCalled();
    expect(String(toastErrorMock.mock.calls[0][0])).toMatch(
      /dropped the upload connection|try again/i,
    );
  });
});
