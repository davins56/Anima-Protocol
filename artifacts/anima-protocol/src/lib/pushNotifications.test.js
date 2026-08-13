import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({
  authHeaders: vi.fn(async () => ({
    "Content-Type": "application/json",
    Authorization: "Bearer test",
  })),
}));

import {
  disableProactivePush,
  enableProactivePush,
  supportsPushNotifications,
  urlBase64ToUint8Array,
} from "./pushNotifications";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pushNotifications", () => {
  let subscription;
  let registration;

  beforeEach(() => {
    subscription = {
      endpoint: "https://push.example.test/subscription",
      options: {},
      toJSON: () => ({
        endpoint: "https://push.example.test/subscription",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
      unsubscribe: vi.fn(async () => true),
    };
    registration = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => subscription),
      },
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: vi.fn(async () => "granted"),
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("decodes URL-safe VAPID keys", () => {
    expect([...urlBase64ToUint8Array("AQIDBA")]).toEqual([1, 2, 3, 4]);
  });

  it("subscribes after a user grants permission and registers the endpoint", async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse({
          configured: true,
          vapid_public_key: "AQIDBA",
          enabled: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ subscribed: true }, 201));

    const result = await enableProactivePush();

    expect(supportsPushNotifications()).toBe(true);
    expect(window.Notification.requestPermission).toHaveBeenCalledOnce();
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 4]),
    });
    expect(result).toBe(subscription);
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/notifications/subscriptions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      }),
    );
  });

  it("removes the server subscription before unsubscribing the browser", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    fetch.mockResolvedValueOnce(jsonResponse({ subscribed: false }));

    await disableProactivePush();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/notifications/subscriptions"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }),
    );
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});
