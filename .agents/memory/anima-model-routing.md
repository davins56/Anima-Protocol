---
name: Anima model routing
description: How/where the chat backend picks an OpenAI model per message, and the fallback rule.
---

# Anima model routing

The chat model is chosen **server-side** in the api-server `POST /openai/conversations/:id/messages`
route. A pure helper module classifies into a tier (light / standard / heavy) from two signals: the
latest message's **stakes** (emotional/analytical/question/code/long content) and **conversation
context** (a `deepMode` toggle from req.body, plus `conversationDepth` = history.length). It resolves
to a concrete model + token budget; tiers are env-overridable (`ANIMA_MODEL_LIGHT|STANDARD|HEAVY`),
and the deep-conversation escalation threshold via `ANIMA_DEEP_CONVERSATION_DEPTH` (default 24). The
SSE `done` event reports the model + tier actually used.

**Tier roles:** `light` = bare greetings/sign-offs (allowlist regex). `heavy` = any stakes-carrying
turn, OR a routine turn when deepMode is on / the thread is deep. `standard` = routine low-stakes
substantive turns (the cost-saving default) AND empty-input/fallback. NOTE: `standard` is no longer
"fallback only" — it is the everyday mid tier for small talk. Stakes signals (`isHighStakesMessage`)
are explicit content signals, NOT just length; a direct "?" alone routes heavy. Keep code detection
structural (`=>`,`{}`, backticks) — bare keywords like `let`/`return` false-positive on
"let's chat"/"return home".

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
