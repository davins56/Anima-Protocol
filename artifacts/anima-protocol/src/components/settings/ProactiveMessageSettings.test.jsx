import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  disableProactivePush: vi.fn(),
  enableProactivePush: vi.fn(),
  getProactiveMessagePreferences: vi.fn(),
  supportsPushNotifications: vi.fn(),
  updateProactiveMessagePreferences: vi.fn(),
}));

vi.mock("@/lib/pushNotifications", () => notificationMocks);

import ProactiveMessageSettings from "./ProactiveMessageSettings";

describe("ProactiveMessageSettings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.supportsPushNotifications.mockReturnValue(true);
    notificationMocks.getProactiveMessagePreferences.mockResolvedValue({
      configured: true,
      enabled: false,
      frequency_hours: 24,
      subscribed: false,
    });
    notificationMocks.enableProactivePush.mockResolvedValue({});
    notificationMocks.updateProactiveMessagePreferences.mockResolvedValue({
      enabled: true,
      frequency_hours: 24,
    });
  });

  it("renders the opt-in and enables outreach after push subscription succeeds", async () => {
    render(<ProactiveMessageSettings />);

    expect(await screen.findByText("Character Messages")).toBeTruthy();
    const toggle = screen.getByRole("switch", {
      name: "Allow character messages outside the app",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(notificationMocks.enableProactivePush).toHaveBeenCalledOnce();
      expect(
        notificationMocks.updateProactiveMessagePreferences,
      ).toHaveBeenCalledWith({ enabled: true, frequencyHours: 24 });
    });
    expect(
      await screen.findByText(
        "Active on this device. Your next check-in is scheduled automatically.",
      ),
    ).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("explains when this deployment has no push credentials", async () => {
    notificationMocks.getProactiveMessagePreferences.mockResolvedValue({
      configured: false,
      enabled: false,
      frequency_hours: 24,
      subscribed: false,
    });

    render(<ProactiveMessageSettings />);

    expect(
      await screen.findByText(
        "Character notifications are not configured on this deployment yet.",
      ),
    ).toBeTruthy();
    const toggle = screen.getByRole("switch", {
      name: "Allow character messages outside the app",
    });
    expect(toggle.disabled).toBe(true);
  });
});
