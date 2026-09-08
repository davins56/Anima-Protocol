import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const uploadFileMock = vi.hoisted(() => vi.fn());
const updateMeMock = vi.hoisted(() => vi.fn());
const meMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  logout: () => {},
  isAuthenticated: true,
  user: {
    id: "user_clerk",
    email: "operator@example.com",
    full_name: "Operator",
    role: "user",
  },
}));

const clerkState = vi.hoisted(() => ({
  isSignedIn: true,
  user: {
    id: "user_clerk",
    fullName: "Operator",
    username: "",
    primaryEmailAddress: { emailAddress: "operator@example.com" },
    emailAddresses: [{ emailAddress: "operator@example.com" }],
    externalAccounts: [],
  },
}));

function clerkUserFromAuth(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username || "",
    primaryEmailAddress: user.email ? { emailAddress: user.email } : null,
    emailAddresses: user.email ? [{ emailAddress: user.email }] : [],
    externalAccounts: [],
  };
}

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
  useAuth: () => authState,
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: clerkState.isSignedIn,
    user: clerkState.user,
  }),
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/api/base44Client", () => ({
  exportData: vi.fn(),
  waitForStoreAuth: vi.fn().mockResolvedValue("token"),
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

import Settings, { normalizeSettingsSection, SECTION } from "./Settings";

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

describe("normalizeSettingsSection", () => {
  it("opens Customise Anima from the settings query string", () => {
    expect(normalizeSettingsSection("customise-anima")).toBe(SECTION.CUSTOMISE_ANIMA);
    expect(normalizeSettingsSection("CUSTOMISE-ANIMA")).toBe(SECTION.CUSTOMISE_ANIMA);
    expect(normalizeSettingsSection("unknown")).toBe(SECTION.ACCOUNT);
    expect(normalizeSettingsSection(null)).toBe(SECTION.ACCOUNT);
  });
});

describe("Settings custom chat background upload", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    updateMeMock.mockReset();
    meMock.mockReset();
    listMock.mockReset();
    toastErrorMock.mockReset();
    authState.isAuthenticated = true;
    authState.user = {
      id: "user_clerk",
      email: "operator@example.com",
      full_name: "Operator",
      role: "user",
    };
    clerkState.isSignedIn = true;
    clerkState.user = clerkUserFromAuth(authState.user);
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

describe("Settings account identity after Clerk login", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    updateMeMock.mockReset();
    meMock.mockReset();
    listMock.mockReset();
    toastErrorMock.mockReset();
    listMock.mockResolvedValue([]);
    updateMeMock.mockResolvedValue({});
    authState.isAuthenticated = true;
    authState.user = {
      id: "user_2github",
      email: "davins56@hotmail.com",
      full_name: "Dàvīn Smith",
      role: "admin",
    };
    clerkState.isSignedIn = true;
    clerkState.user = clerkUserFromAuth(authState.user);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows Clerk identity when auth.me is still empty", async () => {
    meMock.mockResolvedValue({
      role: "User",
      selected_mode: "companion",
    });
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/davins56@hotmail\.com/);
    expect(container.textContent).toMatch(/Dàvīn Smith/);
    expect(container.textContent).not.toMatch(/Email—|Email —/);
  });

  it("keeps Clerk identity when auth.me resolves after a blank first paint", async () => {
    let resolveMe;
    meMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMe = resolve;
        }),
    );
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/davins56@hotmail\.com/);
    expect(container.textContent).toMatch(/Dàvīn Smith/);

    await act(async () => {
      resolveMe({ role: "User", selected_mode: "companion" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/davins56@hotmail\.com/);
    expect(container.textContent).toMatch(/Dàvīn Smith/);
  });

  it("still shows an explicit Instant Sandbox guest identity", async () => {
    authState.user = {
      id: "user_seeker",
      email: "seeker@anima-protocol.com",
      full_name: "Seeker",
      role: "User",
      is_guest: true,
    };
    clerkState.user = clerkUserFromAuth(authState.user);
    meMock.mockResolvedValue({
      id: "user_seeker",
      email: "seeker@anima-protocol.com",
      full_name: "Seeker",
      role: "User",
    });
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/seeker@anima-protocol\.com/);
    expect(container.textContent).toMatch(/Seeker/);
  });

  it("shows Clerk useUser identity when AuthContext user is still null", async () => {
    authState.user = null;
    clerkState.isSignedIn = true;
    clerkState.user = {
      id: "user_2github",
      fullName: "Dàvīn Smith",
      username: "davins56",
      primaryEmailAddress: { emailAddress: "davins56@hotmail.com" },
      emailAddresses: [{ emailAddress: "davins56@hotmail.com" }],
      externalAccounts: [],
    };
    meMock.mockResolvedValue({
      email: "",
      full_name: "",
      role: "User",
    });
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/davins56@hotmail\.com/);
    expect(container.textContent).toMatch(/Dàvīn Smith/);
  });

  it("keeps Clerk identity when auth.me returns empty email and name strings", async () => {
    meMock.mockResolvedValue({
      email: "",
      full_name: "",
      display_name: "",
      role: "User",
      selected_mode: "companion",
    });
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/davins56@hotmail\.com/);
    expect(container.textContent).toMatch(/Dàvīn Smith/);
    expect(container.textContent).not.toMatch(/Email—|Email —/);
  });

  it("lists Serenity and Aelynd on Settings → Customise Anima", async () => {
    listMock.mockImplementation(async () => [
      {
        id: "anima-1",
        name: "Serenity",
        created_date: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "char-aelynd",
        name: "Aelynd",
        created_date: "2026-03-01T00:00:00.000Z",
      },
    ]);
    const { container } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const customiseBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => (btn.textContent || "").replace(/\s+/g, " ").trim() === "Customise Anima",
    );
    expect(customiseBtn).toBeTruthy();
    await act(async () => {
      customiseBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });

    expect(container.textContent).toMatch(/Your Animas/);
    expect(container.textContent).toMatch(/Serenity/);
    expect(container.textContent).toMatch(/Aelynd/);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (btn) => btn.getAttribute("aria-label") === "Customise Aelynd",
      ),
    ).toBe(true);
  });

  it("reloads auth.me when isAuthenticated becomes true", async () => {
    authState.isAuthenticated = false;
    authState.user = null;
    clerkState.isSignedIn = false;
    clerkState.user = null;
    meMock.mockResolvedValue({ role: "User", selected_mode: "companion" });
    const { container, root } = renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsBeforeSignIn = meMock.mock.calls.length;

    authState.isAuthenticated = true;
    authState.user = {
      id: "user_2github",
      email: "davins56@hotmail.com",
      full_name: "Dàvīn Smith",
      role: "admin",
    };
    clerkState.isSignedIn = true;
    clerkState.user = clerkUserFromAuth(authState.user);
    await act(async () => {
      root.render(<Settings />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(meMock.mock.calls.length).toBeGreaterThan(callsBeforeSignIn);
    expect(container.textContent).toMatch(/davins56@hotmail\.com/);
    expect(container.textContent).toMatch(/Dàvīn Smith/);
  });
});
