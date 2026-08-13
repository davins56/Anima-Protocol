import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";

const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

async function request(path, options = {}) {
  const response = await fetch(apiUrl(`/notifications${path}`), {
    ...options,
    credentials: "same-origin",
    headers: await authHeaders(options.headers),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.error || response.statusText || "Notification request failed",
    );
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export function supportsPushNotifications() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function keysMatch(subscription, expected) {
  const actual = subscription?.options?.applicationServerKey;
  if (!actual) return true;
  const actualBytes = new Uint8Array(actual);
  if (actualBytes.length !== expected.length) return false;
  return actualBytes.every((byte, index) => byte === expected[index]);
}

async function serviceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  let timeoutId;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                "The notification service is still starting. Refresh and try again.",
              ),
            ),
          SERVICE_WORKER_READY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

export async function getProactiveMessagePreferences() {
  return request("/preferences");
}

export async function updateProactiveMessagePreferences({
  enabled,
  frequencyHours,
}) {
  return request("/preferences", {
    method: "PUT",
    body: JSON.stringify({
      enabled: Boolean(enabled),
      frequency_hours: Number(frequencyHours),
    }),
  });
}

export async function enableProactivePush({ requestPermission = true } = {}) {
  if (!supportsPushNotifications()) {
    throw new Error("Push notifications are not supported by this browser.");
  }
  const config = await getProactiveMessagePreferences();
  if (!config.configured || !config.vapid_public_key) {
    const error = new Error(
      "Push notifications are not configured on this deployment.",
    );
    error.code = "push_not_configured";
    throw error;
  }
  let permission = window.Notification.permission;
  if (permission === "default" && requestPermission) {
    permission = await window.Notification.requestPermission();
  }
  if (permission !== "granted") {
    const error = new Error(
      permission === "denied"
        ? "Notifications are blocked in your browser settings."
        : "Notification permission is required to enable character messages.",
    );
    error.code = permission === "denied" ? "permission_denied" : "permission_required";
    throw error;
  }

  const registration = await serviceWorkerRegistration();
  const applicationServerKey = urlBase64ToUint8Array(config.vapid_public_key);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !keysMatch(subscription, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }
  await request("/subscriptions", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  return subscription;
}

export async function disableProactivePush() {
  if (!supportsPushNotifications()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await request("/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe().catch(() => false);
  }
}

export async function syncProactivePushIfEnabled(preferences) {
  if (
    !preferences?.enabled ||
    !supportsPushNotifications() ||
    window.Notification.permission !== "granted"
  ) {
    return null;
  }
  return enableProactivePush({ requestPermission: false });
}
