/* global self */

function notificationPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return { title: "Anima Protocol", body: event.data.text(), data: {} };
  }
}

self.addEventListener("push", (event) => {
  const payload = notificationPayload(event);
  if (!payload) return;
  event.waitUntil(
    self.registration.showNotification(payload.title || "Anima Protocol", {
      body: payload.body || "A character sent you a message.",
      icon: payload.icon || "/icon-192.png",
      badge: payload.badge || "/icon-192.png",
      tag: payload.tag || "anima-character-message",
      data: payload.data || {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url || "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if (new URL(client.url).origin !== self.location.origin) continue;
          await client.navigate(targetUrl);
          return client.focus();
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
