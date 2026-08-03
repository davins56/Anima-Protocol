---
name: Anima model routing
description: How/where the chat backend picks an OpenAI model per message, and the failover rule (incl. Grok/xAI).
---

# Anima model routing

The chat model is chosen **server-side** in the api-server chat routes
(`POST /api/chat/messages` and `POST /api/openai/conversations/:id/messages`).
A pure helper module classifies into a tier (light / standard / heavy) from two signals: the
latest message's **stakes** (emotional/analytical/question/code/long content) and **conversation
context** (a `deepMode` toggle from req.body, plus `conversationDepth` = history.length). It resolves
to a concrete model + token budget; tiers are env-overridable (`ANIMA_MODEL_LIGHT|STANDARD|HEAVY`),
and the deep-conversation escalation threshold via `ANIMA_DEEP_CONVERSATION_DEPTH` (default 24). The
SSE `done` event reports the model + tier + **provider** actually used.

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

**Intra-provider fallback:** if the routed OpenAI model fails, retry on the standard model **only**
when the error means the model itself is unavailable (404 / model_not_found / "does not exist" /
"do not have access"). Gated by `isModelUnavailableError`.

**Cross-provider failover (llmFailover.ts):** when OpenAI returns billing / credits / quota /
rate-limit errors (`isProviderUnusableError`, including the classic
"429 You have no credits remaining"), automatically retry on **xAI Grok** if `XAI_API_KEY` is set
(OpenAI-compatible `baseURL` `https://api.x.ai/v1`). After an OpenAI billing failure, subsequent
turns in the same process prefer xAI first (sticky) so we stop hammering a depleted account.
xAI tier models: `ANIMA_XAI_MODEL_LIGHT|STANDARD|HEAVY` or `ANIMA_XAI_MODEL` (defaults
`grok-3-mini` / `grok-3` / `grok-4`).

SSE `done` carries `provider` (`openai` | `xai`) and `failed_over` (true only when *this request*
switched providers mid-flight). The Chat UI shows an OpenAI/Grok badge and toasts on live failover.

**How to apply:** when changing tiers or adding a router LLM, edit the backend router / failover
modules, not the client. If you make `done` carry routing metadata, keep `model`, `tier`, and
`provider` consistent after fallback (report what was actually used).
