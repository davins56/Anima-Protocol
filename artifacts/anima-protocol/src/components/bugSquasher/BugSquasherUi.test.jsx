import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let authState = { user: { id: "user_admin", role: "admin" }, isAuthenticated: true, isLoadingAuth: false };
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/api/authBridge", () => ({ authHeaders: async (extra = {}) => ({ Authorization: "Bearer t", ...extra }) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a) => toastSuccess(...a), error: vi.fn() } }));

import ReportBugDialog from "./ReportBugDialog";
import BugSquasherSettingsCard from "./BugSquasherSettingsCard";
import BugSquasherSync from "./BugSquasherSync";
import BugSquasher from "@/pages/BugSquasher";
import { openBugReport, buildManualReport } from "@/lib/bugSquasher/api";
import { resetBugSquasherForTests, recordBreadcrumb } from "@/lib/bugSquasher/capture";
import { SHOW_TAB_KEY } from "./prefs";

if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => {
  authState = { user: { id: "user_admin", role: "admin" }, isAuthenticated: true, isLoadingAuth: false };
  toastSuccess.mockReset();
  window.localStorage.clear();
  resetBugSquasherForTests();
});

afterEach(() => {
  cleanup();
  resetBugSquasherForTests();
});

const group = (over = {}) => ({
  fingerprint: "a_0123456789abcdef0123456789abcdef",
  status: "new",
  kind: "chat_failure",
  title: "Chat turn failed: post (post)",
  message: "The companion returned an empty reply. Please try again.",
  route: "/chat/s1",
  app_version: "c9d2565a",
  total_count: 12,
  user_count: 3,
  reopen_count: 1,
  first_seen: "2026-11-23T10:00:00Z",
  last_seen: "2026-11-23T12:00:00Z",
  has_screenshot: false,
  admin_note: null,
  ...over,
});

describe("buildManualReport", () => {
  it("scrubs the description and attaches context only when asked", () => {
    recordBreadcrumb("nav", "/settings");
    const withCtx = buildManualReport({ description: "Send froze. my token=abc123 and me@x.com", includeContext: true });
    expect(withCtx.kind).toBe("manual");
    expect(withCtx.description).not.toMatch(/abc123|me@x\.com/);
    expect(withCtx.context.breadcrumbs.length).toBeGreaterThan(0);
    const without = buildManualReport({ description: "Send froze", includeContext: false });
    expect(without.context).toEqual({});
  });
});

describe("ReportBugDialog", () => {
  it("requires a description, then submits with context and an optional screenshot", async () => {
    const api = {
      submitManualReport: vi.fn(async () => ({ id: "r1", count: 1 })),
      captureScreenshot: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
    };
    const onOpenChange = vi.fn();
    render(<ReportBugDialog open onOpenChange={onOpenChange} api={api} />);

    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/tell us a little/i);
    expect(api.submitManualReport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /see what's attached/i }));
    expect(screen.getByTestId("bug-context-preview").textContent).toContain("app_version");

    fireEvent.click(screen.getByRole("button", { name: /attach screenshot/i }));
    expect(await screen.findByAltText("Screenshot to attach")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "The reply never showed up" } });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    await waitFor(() => expect(api.submitManualReport).toHaveBeenCalled());
    expect(api.submitManualReport.mock.calls[0][0]).toMatchObject({
      description: "The reply never showed up",
      includeContext: true,
      screenshot: "data:image/jpeg;base64,AAAA",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("shows the server's error and stays open", async () => {
    const api = {
      submitManualReport: vi.fn(async () => {
        throw new Error("Bug reports aren't switched on yet");
      }),
      captureScreenshot: vi.fn(),
    };
    const onOpenChange = vi.fn();
    render(<ReportBugDialog open onOpenChange={onOpenChange} api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Broken thing" } });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/switched on/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("BugSquasherSync", () => {
  it("opens the panel from openBugReport() and shows the edge tab for admins", async () => {
    render(
      <MemoryRouter>
        <BugSquasherSync />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /report a bug/i })).toBeTruthy();
    let handled = false;
    act(() => {
      handled = openBugReport({ description: "From the crash screen" });
    });
    expect(handled).toBe(true);
    expect(await screen.findByDisplayValue("From the crash screen")).toBeTruthy();
  });

  it("hides the tab for regular users unless they opt in", () => {
    authState = { user: { id: "user_1", role: "user" }, isAuthenticated: true, isLoadingAuth: false };
    const { unmount } = render(
      <MemoryRouter>
        <BugSquasherSync />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /report a bug/i })).toBeNull();
    unmount();
    window.localStorage.setItem(SHOW_TAB_KEY, "1");
    render(
      <MemoryRouter>
        <BugSquasherSync />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /report a bug/i })).toBeTruthy();
  });

  it("renders nothing when signed out", () => {
    authState = { user: null, isAuthenticated: false, isLoadingAuth: false };
    const { container } = render(
      <MemoryRouter>
        <BugSquasherSync />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("BugSquasherSettingsCard", () => {
  it("lists the user's reports and links admins to triage", async () => {
    const api = {
      listMyReports: vi.fn(async () => [
        { id: "r1", kind: "manual", status: "fixed", title: "Send froze", count: 2, last_seen: new Date().toISOString() },
      ]),
    };
    render(
      <MemoryRouter>
        <BugSquasherSettingsCard isAdmin api={api} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Send froze")).toBeTruthy();
    expect(screen.getByText("Fixed")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open bug squasher triage/i }).getAttribute("href")).toBe("/bug-squasher");
  });

  it("does not show the triage link to regular users", async () => {
    render(
      <MemoryRouter>
        <BugSquasherSettingsCard api={{ listMyReports: async () => [] }} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no reports yet/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /triage/i })).toBeNull();
  });
});

describe("BugSquasher triage page", () => {
  function renderPage(api) {
    return render(
      <MemoryRouter>
        <BugSquasher api={api} />
      </MemoryRouter>,
    );
  }

  it("is admin-only", () => {
    authState = { user: { id: "user_1", role: "user" }, isAuthenticated: true, isLoadingAuth: false };
    const api = { listBugGroups: vi.fn() };
    renderPage(api);
    expect(screen.getByText(/available to admins/i)).toBeTruthy();
    expect(api.listBugGroups).not.toHaveBeenCalled();
  });

  it("lists grouped bugs, filters by status, and marks one fixed", async () => {
    const api = {
      listBugGroups: vi.fn(async () => [
        group(),
        group({ fingerprint: "a_ffffffffffffffffffffffffffffffff", status: "fixed", title: "Old crash", total_count: 1, user_count: 1, reopen_count: 0 }),
      ]),
      getBugGroup: vi.fn(async () => [
        {
          id: "11111111-1111-1111-1111-111111111111",
          user_id: "user_a",
          kind: "chat_failure",
          status: "new",
          title: "Chat turn failed: post (post)",
          count: 9,
          reopen_count: 1,
          route: "/chat/s1",
          app_version: "c9d2565a",
          user_agent: "Mozilla/5.0",
          context: { chat: { failure_type: "post", phase: "post", turn_id: "turn_9" }, breadcrumbs: [{ at: "2026-11-23T12:00:00Z", type: "nav", message: "/chat/s1" }] },
          last_seen: "2026-11-23T12:00:00Z",
          first_seen: "2026-11-23T10:00:00Z",
          has_screenshot: false,
        },
      ]),
      setBugGroupStatus: vi.fn(async () => ({ updated: 3 })),
      getBugScreenshot: vi.fn(),
    };
    renderPage(api);

    // "Open" filter hides the fixed group.
    expect(await screen.findByText("Chat turn failed: post (post)")).toBeTruthy();
    expect(screen.queryByText("Old crash")).toBeNull();
    expect(screen.getByText("×12")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /fixed/i }));
    expect(screen.getByText("Old crash")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /open/i }));

    fireEvent.click(screen.getByText("Chat turn failed: post (post)"));
    const detail = await screen.findByTestId("bug-group-detail");
    expect((detail).textContent).toMatch("12 from 3 users");
    expect((await screen.findByTestId("bug-report-row")).textContent).toMatch("user_a");
    expect(screen.getByText(/turn turn_9/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "PR #781" } });
    fireEvent.click(screen.getByRole("button", { name: /mark fixed/i }));
    await waitFor(() =>
      expect(api.setBugGroupStatus).toHaveBeenCalledWith("a_0123456789abcdef0123456789abcdef", "fixed", "PR #781"),
    );
    await waitFor(() => expect(api.listBugGroups).toHaveBeenCalledTimes(2));
  });

  it("shows a load error (e.g. migration not applied)", async () => {
    const api = {
      listBugGroups: vi.fn(async () => {
        throw new Error("Bug reports aren't switched on yet (the database migration hasn't been applied).");
      }),
    };
    renderPage(api);
    expect((await screen.findByRole("alert")).textContent).toMatch(/migration/);
  });
});
