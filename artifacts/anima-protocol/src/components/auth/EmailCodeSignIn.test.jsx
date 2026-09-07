import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const clerkMocks = vi.hoisted(() => ({
  signIn: {
    sso: vi.fn(),
    status: null,
    finalize: vi.fn(),
    create: vi.fn(),
  },
  fetchStatus: "idle",
  isLoaded: true,
  isSignedIn: false,
  clerk: {},
  loginAsLocalUser: vi.fn(),
  isSignedInUser: false,
  isGuest: false,
  navigate: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useSignIn: () => ({
    signIn: clerkMocks.signIn,
    fetchStatus: clerkMocks.fetchStatus,
  }),
  useUser: () => ({
    isLoaded: clerkMocks.isLoaded,
    isSignedIn: clerkMocks.isSignedIn,
  }),
  useClerk: () => clerkMocks.clerk,
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    loginAsLocalUser: clerkMocks.loginAsLocalUser,
    isSignedInUser: clerkMocks.isSignedInUser,
    isGuest: clerkMocks.isGuest,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => clerkMocks.navigate,
  };
});

import EmailCodeSignIn from "./EmailCodeSignIn";
import {
  CLERK_GITHUB_OAUTH_CALLBACK_URL,
  PRODUCTION_SIGN_IN_URL,
} from "@/lib/emailCodeSignIn";

function renderSignIn() {
  return render(
    <MemoryRouter>
      <EmailCodeSignIn />
    </MemoryRouter>,
  );
}

describe("EmailCodeSignIn GitHub hang", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clerkMocks.fetchStatus = "idle";
    clerkMocks.isLoaded = true;
    clerkMocks.isSignedIn = false;
    clerkMocks.isSignedInUser = false;
    clerkMocks.isGuest = false;
    clerkMocks.signIn.status = null;
    clerkMocks.signIn.sso = vi.fn();
  });

  it("clears Redirecting… and shows the hang error when sso never navigates", async () => {
    vi.useFakeTimers();
    clerkMocks.signIn.sso.mockReturnValue(new Promise(() => {}));
    renderSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Continue with GitHub/i }));
    expect(screen.getByRole("button", { name: /Redirecting to GitHub/i })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(PRODUCTION_SIGN_IN_URL);
    expect(alert.textContent).toContain(CLERK_GITHUB_OAUTH_CALLBACK_URL);
    expect(screen.getByRole("button", { name: /Continue with GitHub/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Redirecting to GitHub/i })).toBeNull();
  });

  it("clears busy and surfaces an incomplete Clerk status", async () => {
    clerkMocks.signIn.status = "needs_first_factor";
    clerkMocks.signIn.sso.mockResolvedValue({ error: null });
    renderSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Continue with GitHub/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/needs_first_factor|did not finish/i);
    });
    expect(screen.getByRole("alert").textContent).toContain(PRODUCTION_SIGN_IN_URL);
    expect(screen.getByRole("button", { name: /Continue with GitHub/i })).toBeTruthy();
  });

  it("clears busy after a Clerk sso error", async () => {
    clerkMocks.signIn.sso.mockResolvedValue({
      error: { message: "GitHub is temporarily unavailable." },
    });
    renderSignIn();

    fireEvent.click(screen.getByRole("button", { name: /Continue with GitHub/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/temporarily unavailable/i);
    });
    expect(screen.getByRole("button", { name: /Continue with GitHub/i })).toBeTruthy();
  });
});
