# Plan: remove chat's automatic OpenRouter fallback

Status: **plan only.** Nothing in this branch changes chat routing. Voice
already fails closed (docs/voice-local.md); this plan does the same for chat
once you approve it.

## What happens today (origin/main 2314db2)

| Where | What |
|---|---|
| `wrangler.jsonc:114` | `"ANIMA_CHAT_BRAIN": "cloudflare"`: chat runs on Workers AI inside the Worker. |
| `wrangler.jsonc:117-121` | `"ANIMA_OPENROUTER_FALLBACK": "true"`, commented "Temporary until Workers Paid / quota recovers". |
| `wrangler.jsonc:206-209` | Comment: Dàvīn approved temporary OpenRouter failover when no custom host is set. |
| `wrangler.jsonc:167-171` | Secrets Store binding `OPENROUTER_API_KEY`. |
| `llmFailover.ts:427` `allowOpenRouterFallback()` | True when the var is `1`/`true`/`yes`. |
| `llmFailover.ts:595` `getProviderChain()` | No usable self-hosted URL plus an AI binding gives `["workersai"]`, then `"openrouter"` is added when the flag is on and the key is bound. A usable self-hosted URL gives `["local"]` (OpenRouter only with the separate `ANIMA_LOCAL_LLM_FALLBACK`, which is off). |
| `llmFailover.ts:779` `isWorkersAiHoppableError()` | Ends with `return Boolean(err)`: **any** Workers AI error hops to OpenRouter while the flag is on, not only quota 4006. |
| `Chat.jsx:2788-2793` | Shows the toast "Switched to Venice Uncensored via OpenRouter." when that happens. |
| `chatTurnError.js:18-30` | The 4006 copy tells the steward to "temporarily allow OpenRouter failover". |
| `docs/chat-brain.md:62-64` | Documents the same temporary hop. |

So today a Workers AI failure silently sends the conversation (persona
prompt, recent history, retrieved memories) to OpenRouter.

## The change

1. **Config.** At `wrangler.jsonc:121` set `"ANIMA_OPENROUTER_FALLBACK": "false"`
   (or delete the key; unset reads as off, `llmFailover.ts:428`). Rewrite the
   comments at `:117-120` and `:206-209` to say the fallback is retired.
   Keep the `OPENROUTER_API_KEY` binding for now: removing a Secrets Store
   binding is a separate deploy decision, and other paths may still read the
   key (check with `rg OPENROUTER_API_KEY artifacts/api-server/src` first).
2. **Code (optional, safer default).** Make `allowOpenRouterFallback()`
   need an explicit opt-in only (it already does), and narrow
   `isWorkersAiHoppableError()` so it does not end in `return Boolean(err)`.
   With the flag off this has no effect, because `getProviderChain()` no
   longer adds `openrouter`, so `shouldTryNextProvider()` gets `hasNext=false`.
3. **Offline state.** With no next provider the turn fails through the
   existing mapping (`chatCompletionHttpFailure`, `llmFailover.ts:111`): `ai_timeout` (502),
   `ai_request_failed` (502/503) or the 4006 message. Add one code,
   `chat_offline` with `reason` (`quota_exhausted` | `provider_error` |
   `timeout`) and `cloudFallback:false`, the same shape as `voice_offline`, so
   the Builder can show one "she's resting" state for both. Change the 4006
   copy in `chatTurnError.js:30` so it no longer suggests turning the fallback
   back on.
4. **Client.** Keep the `failed_over` toast (`Chat.jsx:2788`) for
   any opted-in provider but it will not fire by default. No UI is removed.
5. **Tests to update (they set the flag explicitly):**
   `llmFailover.test.ts` (~953-1077), `aiChat.localLlm.test.ts:258`,
   `llmWarmRoute.test.ts:76`, `gcpCloudRunStaging.test.ts:163`. Add one test:
   no flag means a Workers AI 4006 returns `chat_offline` and calls no
   OpenRouter URL (fetch spy, like `voiceClipCascade.test.ts`).
6. **Docs.** `docs/chat-brain.md:62-64` and the `/api/healthz/llm` note at
   `llmFailover.ts:~1650-1702`.

## What the steward will see

- Today, after 10,000 Workers AI neurons in a day (free plan, error 4006), chat
  keeps working on OpenRouter's free model.
- After the change, chat stops until the quota resets (00:00 UTC, 19:00 EST)
  or Workers Paid is on, and shows the offline state instead.

## Risks

- **Availability.** The free-plan quota becomes a hard daily stop. Mitigations:
  Workers Paid, `ANIMA_WORKERS_AI_BACKGROUND=false` (stops background jobs
  spending neurons), or `ANIMA_CHAT_BRAIN=self-hosted` once the home box serves
  chat.
- **Broad hop today.** `isWorkersAiHoppableError()` hops on any error, so
  some failures being masked today (3006, empty replies) will become visible.
  That is intended, but expect more visible errors the first week.
- **Group chat and background jobs** use the same chain. Check that the
  memory consolidation and dream jobs skip cleanly with no provider, rather
  than retrying in a loop.
- **Rollback** is one var: set it back to `"true"` and deploy. No data or
  schema change either way. No migration.

## Not in this plan
Deploying, removing the `OPENROUTER_API_KEY` binding, and MiniMax/Deepshi
routes (the chain never falls through to them, per the `getProviderChain()`
doc comment at `llmFailover.ts:587-594`).
