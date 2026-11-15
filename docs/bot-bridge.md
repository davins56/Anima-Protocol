# Anima ↔ Grok Bot bridge

Status: **skeleton, off by default.** The plan (design proposal, Revision 2) is
approved; the six migrations M1–M6 and the read-only production check (Phase 0)
are **not**. This code needs no migration: every route verifies and validates,
then answers `503 bridge_disabled` because the storage it needs does not exist.

## Flag and environment

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `ANIMA_BOT_BRIDGE` | var | off | `on` / `true` / `1` enables the routes. Anything else: `503 bridge_disabled`. |
| `ANIMA_BRIDGE_SECRET_<BOT_ID>` | **Worker secret** | unset | Per-bot HMAC signing secret, ≥ 32 chars. `<BOT_ID>` is the bot id upper-cased with `-` → `_` (`chief-of-staff` → `ANIMA_BRIDGE_SECRET_CHIEF_OF_STAFF`). Unset or short = unknown bot (401). Never a `VITE_` var, never logged, never returned. |
| `ANIMA_BRIDGE_STATUS_PUBLISHERS` | var | empty | Comma list of bot ids allowed to post status for *other* bots (the digest sender). Everyone else may only report itself. |
| `ANIMA_BRIDGE_INBOUND_PER_MINUTE` | var | 30 | Inbound requests per bot per minute (1–120). |
| `ANIMA_BRIDGE_INBOUND_DAILY_LIMIT` | var | 200 | Inbound requests per user per day (1–2000). |
| `ANIMA_BRIDGE_OUTBOUND_DAILY_LIMIT` | var | 20 | Outbound drafts per companion per day (0–500, mirrors `tool_permissions.daily_limit`). |
| `ANIMA_BRIDGE_MESSAGE_MAX_BYTES` | var | 4096 | Raw body cap for `/message` (256–4096; cannot be raised). |
| `ANIMA_BRIDGE_STATUS_MAX_BYTES` | var | 8192 | Raw body cap for `/status` (512–8192; cannot be raised). |
| `ANIMA_BRIDGE_STATUS_TTL_HOURS` | var | 6 | Older status is shown as "last heard", never as current. |
| `ANIMA_BRIDGE_CONFIRM_TTL_HOURS` | var | 24 | Pending anima→bot confirmations expire. |

Out-of-range or malformed values fall back to the default.

## Inbound requests (bot → anima)

```
POST /api/webhooks/bot-bridge/status    (digest, ≤ 8 KB)
POST /api/webhooks/bot-bridge/message   (note to one companion, ≤ 4 KB)
Content-Type: application/json
X-Anima-Bridge-Bot: chief-of-staff
X-Anima-Bridge-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>." + rawBody)>
```

Signing in a bot routine (Node):

```js
const t = Math.floor(Date.now() / 1000);
const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
```

Checks, in order: flag → content type → body cap (413) → headers, bot id,
`|now − t| ≤ 300 s`, secret configured, constant-time HMAC compare
(`timingSafeEqualString`) → 401 `bridge_unauthorized` (no detail) → JSON + zod
(strict; unknown keys such as `user_id` rejected; 400 with issue paths only) →
publisher rule (403) → **storage available? otherwise 503 `bridge_disabled`** →
replay (in-isolate signature cache, then `(user_id, dedupe_key)`) → registry →
kill switch (202 dropped, logged denied) → rate limits (429 + `Retry-After`) →
classifier (NSFW dropped, instruction-like text stored but flagged) → store.

The owning user always comes from the registry (M2). Nothing in a request can
choose the account.

Status digest:

```json
{ "v": 1, "dedupe_key": "digest-2026-11-14T22",
  "bots": [{ "bot_id": "anima-backend-data", "display_name": "Anima Backend Data",
             "role": "Supabase/API work", "state": "working",
             "summary": "Reviewing the bridge data model",
             "items": [{ "title": "PR #745", "status": "merged", "url": "https://github.com/..." }],
             "as_of": "2026-11-14T22:30:00Z" }] }
```

Message:

```json
{ "v": 1, "dedupe_key": "msg-000001", "to": { "companion_name": "Serenity" },
  "body": "The recap fix is merged.", "sent_at": "2026-11-14T22:30:00Z" }
```

## Signed-in UI endpoints (`/api/bridge`)

`GET /config` → `{ enabled, capabilities }` (always 200 for a signed-in user;
`enabled` is false until the flag is on **and** storage exists). `GET /bots`,
`GET|PUT /permissions`, `POST /drafts/:id/decision`, `POST /messages/:id/remember`
return `503 bridge_disabled` until then. The front end hides everything unless
`enabled` is true.

## Prompt fencing

`lib/botBridge/fence.ts` builds the `BOT STATUS` / `BOT MESSAGE` blocks with the
same untrusted wording as web search (`UNTRUSTED_REFERENCE_RULE`), strips fence
markers and role tags from inside the content, labels stale rows, and withholds
anything the classifier flags. Nothing calls it from chat yet.

## Blocked on migrations

| Piece | Needs |
|---|---|
| Registry lookup (owner, inbound enabled) | M2 `bot_registry` |
| Status storage, "Your bots" panel data | M2, M3 `bot_status` |
| Inbound message storage, durable dedupe, bot message bubble, push to owner | M4 `bridge_messages` (+ M1 for the audit rows) |
| Denied/accepted audit rows, kill switch, per-companion permissions | M1 (tool_* CHECKs + `inbound_bot`), and `20261111020000_tools_guardrails` confirmed applied (Phase 0) |
| "Remember this" | M6 (`bot_exchange` type + `recall_memories` exclusion) |
| Outbound Send, standing permission ("Allow without asking") | M1 + tools-guardrails runtime |

Until then `getBotBridgeStorage()` returns `disabledBotBridgeStorage`.
