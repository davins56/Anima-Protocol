import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/api/animaApi", () => ({ animaApi: {} }));

import { track } from "@/lib/analytics";
import AddOnPlans from "./AddOnPlans";

function apiWith(status, checkout = vi.fn(async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test_1" }))) {
  return { billing: { status: vi.fn(async () => status), checkout } };
}

beforeEach(() => {
  vi.mocked(track).mockClear();
  localStorage.clear();
});

describe("AddOnPlans", () => {
  it("redirects to Stripe Checkout with only the offer id", async () => {
    const api = apiWith({
      enabled: true,
      test_mode: true,
      offers: [{ id: "photo_credits", units: 20, unit_label: "credits", available: true }],
      balances: { photo_credits: 2, voice_minutes: 0, deep_mode_active_until: null },
    });
    const redirect = vi.fn();
    render(<AddOnPlans api={api} redirect={redirect} />);
    fireEvent.click(await screen.findByTestId("buy-photo_credits"));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(api.billing.checkout).toHaveBeenCalledWith("photo_credits");
    expect(track).toHaveBeenCalledWith("subscription_upgrade_started", { tier: "photo_credits", purchase_type: "one_time", from_tier: "free" });
    expect(screen.getByTestId("test-mode-note")).toBeTruthy();
    expect(screen.getByTestId("balances").textContent).toContain("2 photo credits");
    // Not configured on the server → waitlist, never a checkout
    expect(screen.getByTestId("waitlist-deep_mode")).toBeTruthy();
  });

  it("falls back to the waitlist when billing is off", async () => {
    const api = apiWith({ enabled: false, offers: [] });
    render(<AddOnPlans api={api} redirect={vi.fn()} />);
    const btn = await screen.findByTestId("waitlist-voice_minutes");
    await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(btn);
    expect(track).toHaveBeenCalledWith("subscription_upgrade_started", { tier: "voice_minutes", purchase_type: "waitlist", from_tier: "free" });
    expect(screen.getByText("On the waitlist")).toBeTruthy();
    expect(api.billing.checkout).not.toHaveBeenCalled();
  });

  it("shows an error when checkout fails", async () => {
    const api = apiWith(
      { enabled: true, offers: [{ id: "deep_mode", units: 30, unit_label: "days", available: true }] },
      vi.fn(async () => {
        throw Object.assign(new Error("x"), { status: 502 });
      }),
    );
    render(<AddOnPlans api={api} redirect={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("buy-deep_mode"));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
