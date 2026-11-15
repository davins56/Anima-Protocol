/**
 * Push notifications for bot messages, reusing the app's existing Web Push
 * setup (public/push-notifications-sw.js + lib/pushNotifications.js).
 *
 * Client side only for now: it asks for notification permission and makes
 * sure this device has a push subscription (the same one proactive messages
 * use; registering a subscription does not turn proactive messages on). The
 * server sends a bot-message push (tag `anima-bot-message`, `data.url` = the
 * companion's chat) only once inbound messages are stored (migration M4) and
 * respects quiet hours. Until the server reports `inboundMessages`, `enable`
 * refuses.
 */
import { useCallback, useState } from "react";
import { enableProactivePush, supportsPushNotifications } from "@/lib/pushNotifications";

export type BotPushState = "unsupported" | "unavailable" | "default" | "granted" | "denied" | "error";

function currentPermission(): BotPushState {
  if (!supportsPushNotifications()) return "unsupported";
  const p = window.Notification.permission;
  return p === "granted" || p === "denied" ? p : "default";
}

export function useBotMessagePush({ available }: { available: boolean }) {
  // Result of the last enable() attempt; null means "read the browser's permission".
  const [state, setState] = useState<BotPushState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const enable = useCallback(async () => {
    if (!available) {
      setState("unavailable");
      return false;
    }
    if (!supportsPushNotifications()) {
      setState("unsupported");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await enableProactivePush({ requestPermission: true });
      setState("granted");
      return true;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setState(code === "permission_denied" ? "denied" : code === "permission_required" ? "default" : "error");
      setError(err instanceof Error ? err.message : "Could not turn on notifications.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [available]);

  const effective: BotPushState = !available ? "unavailable" : (state ?? currentPermission());
  return { state: effective, error, busy, enable };
}
