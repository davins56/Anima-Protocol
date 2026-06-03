---
name: Anima model routing
description: How/where the chat backend picks an OpenAI model per message, and the fallback rule.
---

# Anima model routing

The chat model is chosen **server-side** in the api-server `POST /openai/conversations/:id/messages`
route, based purely on the text of the latest user message. A pure helper module classifies the
message into a tier (light / standard / heavy) and resolves it to a concrete model + token budget;
tiers are env-overridable (`ANIMA_MODEL_LIGHT|STANDARD|HEAVY`). The SSE `done` event reports the
model + tier actually used.

**Why server-side:** the web client's `InvokeLLM({ ..., model })` silently drops `model` (it only
forwards `prompt`/`systemPrompt` through `animaApi.sendMessage`). So any client-side model choice is
dead — model selection MUST happen in the backend route, which is the single source of truth.

**Fallback rule:** if the routed model fails, retry on the standard model **only** when the error
means the model itself is unavailable (404 / model_not_found / "does not exist" / "do not have
access"). Quota / rate-limit (429) / transient (5xx) errors must surface as-is — do NOT retry, or
you burn a second doomed call and hide the real cause. Keep this gated by an explicit
`isModelUnavailableError`-style predicate.

**How to apply:** when changing tiers or adding a router LLM, edit the backend router module, not the
client. If you make `done` carry routing metadata, keep `model` and `tier` consistent after fallback
(report the tier actually used, not the originally-chosen one).

**Note:** OpenAI calls can 429 on account quota regardless of routing — that's a billing limit, not a
routing bug. The same 429 hit the old hardcoded `gpt-4o` path.
