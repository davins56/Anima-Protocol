import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
  whenBootstrapReady: vi.fn(),
  waitForStoreAuth: vi.fn(),
  navigate: vi.fn(),
  auth: {
    isAuthenticated: true,
    isLoadingAuth: false,
    user: { email: "operator@example.com" },
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: mocks.me },
    entities: {
      Anima: { list: mocks.listAnima },
      Character: { list: mocks.listCharacter },
    },
  },
  waitForStoreAuth: mocks.waitForStoreAuth,
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: mocks.whenBootstrapReady,
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/components/anima/AnimaCustomizer", () => ({
  default: ({ anima }) => <div>Look panel {anima.name}</div>,
}));
vi.mock("@/components/anima/AnimaPersonalityPanel", () => ({
  default: () => <div>Personality panel</div>,
}));
vi.mock("@/components/anima/AnimaSoulprintPanel", () => ({
  default: () => <div>Soulprint panel</div>,
}));
vi.mock("@/components/anima/AnimaVoicePanel", () => ({
  default: () => <div>Voice panel</div>,
}));
vi.mock("@/components/anima/AnimaExpressionPanel", () => ({
  default: () => <div>Expression panel</div>,
}));
vi.mock("@/components/anima/DeviceScanPanel", () => ({
  default: () => <div>Permissions panel</div>,
}));

import CustomiseAnima from "./CustomiseAnima";

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomiseAnima />
    </MemoryRouter>,
  );
}

describe("Customise Anima hub", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.isAuthenticated = true;
    mocks.auth.isLoadingAuth = false;
    mocks.auth.user = { email: "operator@example.com" };
    mocks.me.mockResolvedValue({ email: "operator@example.com" });
    mocks.whenBootstrapReady.mockResolvedValue(undefined);
    mocks.waitForStoreAuth.mockResolvedValue("token");
    mocks.listAnima.mockResolvedValue([]);
    mocks.listCharacter.mockResolvedValue([]);
  });

  it("shows a signed-in empty list, not the misconfigured banner", async () => {
    renderPage();

    expect(await screen.findByText("No personal Anima found yet.")).toBeTruthy();
    expect(screen.queryByText(/API is misconfigured/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Forge Anima/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Forge Anima/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/onboarding");
  });

  it("distinguishes missing env from an unsigned session", async () => {
    mocks.listAnima.mockRejectedValue(
      Object.assign(
        new Error("API is misconfigured on the server. Check environment variables."),
        { status: 503 },
      ),
    );
    renderPage();

    expect(
      await screen.findByText("API is misconfigured on the server. Check environment variables."),
    ).toBeTruthy();
    expect(screen.getByText(/server configuration problem/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Forge Anima/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sign in/i })).toBeNull();
  });

  it("asks the operator to sign in when there is no session", async () => {
    mocks.auth.isAuthenticated = false;
    renderPage();

    expect(await screen.findByText("Sign in to customise your Anima.")).toBeTruthy();
    expect(screen.queryByText(/API is misconfigured/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/sign-in");
    expect(mocks.listAnima).not.toHaveBeenCalled();
  });

  it("surfaces a database outage without calling it misconfigured", async () => {
    mocks.listAnima.mockRejectedValue(
      Object.assign(new Error("Database host unreachable"), { status: 503 }),
    );
    renderPage();

    expect(
      await screen.findByText("The companion store cannot reach the database."),
    ).toBeTruthy();
    expect(screen.getByText(/Database host unreachable/)).toBeTruthy();
    expect(screen.queryByText(/API is misconfigured/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Forge Anima/i })).toBeNull();
  });

  it("retries the companion load instead of reloading the window", async () => {
    mocks.listAnima
      .mockRejectedValueOnce(
        Object.assign(new Error("Database unavailable"), { status: 503 }),
      )
      .mockResolvedValueOnce([
        { id: "anima-1", name: "Serenity", assigned_user: "operator@example.com" },
      ]);

    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload },
    });

    renderPage();
    expect(
      await screen.findByText("The companion store cannot reach the database."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getByText("Look panel Serenity")).toBeTruthy();
    });
    expect(mocks.listAnima).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Look/i })).toBeTruthy();
  });

  it("loads the personal Anima hub when the store works", async () => {
    mocks.listAnima.mockResolvedValue([
      { id: "anima-1", name: "Serenity", assigned_user: "operator@example.com" },
    ]);
    renderPage();

    expect(await screen.findByText("Look panel Serenity")).toBeTruthy();
    expect(screen.getByText(/Serenity · Portrait/)).toBeTruthy();
    expect(screen.queryByText(/API is misconfigured/i)).toBeNull();
  });

  it("lists a Companion Generator character so her look can be drafted", async () => {
    mocks.listAnima.mockResolvedValue([
      { id: "anima-1", name: "Serenity", assigned_user: "operator@example.com" },
    ]);
    mocks.listCharacter.mockResolvedValue([
      {
        id: "char-nyx",
        name: "Nyx",
        creation_method: "ai_prompt",
        created_date: "2026-09-05T00:00:00.000Z",
      },
    ]);
    renderPage();

    expect(await screen.findByText("Nyx")).toBeTruthy();
    expect(screen.getByText("Serenity")).toBeTruthy();
  });
});
