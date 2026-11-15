# Bot bridge UI (Anima ↔ Grok Bot)

Hidden unless `GET /api/bridge/config` returns `{ "enabled": true }`. That needs
the server flag `ANIMA_BOT_BRIDGE=on` **and** the bridge tables (migrations
M1–M6, not yet approved). Any error, 404 or unexpected shape counts as disabled,
so on today's server nothing renders.

| Piece | File | Live when |
|---|---|---|
| Settings > "Your bots" container | `src/components/botBridge/BotBridgeSettings.tsx` (lazy in `pages/Settings.jsx`) | `enabled` |
| Status cards (name, what it's working on, open items, last active, stale > 6 h) | `BotAwarenessPanel.tsx` | M2 + M3 |
| Anima→bot confirm card (exact text, Send / Cancel) | `BotDraftConfirmCard.tsx` | M1 + tools-guardrails runtime |
| Companion × bot permissions ("Ask every time" default; "Allow without asking" disabled) | `BotPermissionSettings.tsx` | M1 (standing permission: later) |
| Inbound bot message bubble ("outside the app", plain text, "Remember this" disabled) | `BotMessageBubble.tsx` | M4; Remember: M6 |
| Push for bot messages | `src/hooks/useBotMessagePush.ts` | M4 |

There is no tools-guardrails confirm UI on main yet, so the confirm card is
standalone and calls `POST /api/bridge/drafts/:id/decision` (503 today). The
chat thread does not render the card or the bubble yet; that wiring lands with
the data (M4 / outbound runtime). Tests use `src/components/botBridge/fixtures.ts`.

## Bot text is untrusted

Rendered as React text only (no `dangerouslySetInnerHTML`, no markdown), links
shown as their domain and never clickable, flagged messages say so.

## Push notifications

Reuses the existing Web Push setup: `lib/pushNotifications.js`
(`enableProactivePush`) and `public/push-notifications-sw.js`. The hook asks
for notification permission and makes sure this device has a push
subscription. Registering a subscription does not turn proactive companion
messages on (those need `notification_preferences.enabled`).

Server side, once M4 stores inbound messages, a bot message sends a Web Push
with `tag: "anima-bot-message"` and `data.url` set to that companion's chat;
the existing service worker already shows it and opens the URL on click. No
push during quiet hours. A per-user "bot message alerts" preference needs a
place to live (registry or notification preferences) and is part of the
migration review.
