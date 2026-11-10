# Chat brain on Cloudflare (no Fly.io, no DigitalOcean)

The companion "brain" — identity, memory, prompt, model call, memory write —
runs entirely inside the production Cloudflare Worker (`wrangler.jsonc`,
`artifacts/api-server/src/worker.ts`). With `ANIMA_CHAT_BRAIN=cloudflare`
(committed in `wrangler.jsonc` `vars`) there is **no separate model host**:
no Fly.io app, no DigitalOcean droplet, no VPS, no home box + tunnel.

## How one chat turn works

```
Chat UI (artifacts/anima-protocol)
  └─ POST /api/chat/messages  (SSE, Clerk session JWT, same-origin)
       Cloudflare Worker → Express api-server
         1. Clerk middleware verifies the session; CORS via lib/corsPolicy.ts
         2. Load vessel identity + memory in parallel (Hyperdrive → Postgres):
              character_identity_current, recall_memories(...) over the
              append-only memory_events stream (supabase/migrations/2026102216*)
         3. promptBuilder / composeCompanionChatMessages builds the prompt
         4. llmFailover → Workers AI (env.AI via AI Gateway deepseek-gateway),
              streamed back to the UI token by token
              (OpenRouter only if ANIMA_OPENROUTER_FALLBACK=true and the
               free Workers AI quota (error 4006) is exhausted)
         5. Persist the turn, append a `turn` event to memory_events
              (dedupe_key turn:<turnId>), embed it with Workers AI
              @cf/baai/bge-base-en-v1.5
  Background brain jobs (scene director, evolution, consolidation, dreams,
  journal, resting mode, proactive lines) run on the same Workers AI binding
  with a small non-reasoning model.
```

The frontend already talks to this path (`src/api/animaApi.js` →
`/api/chat/messages`, same-origin on anima-protocol.com); nothing in the chat
UI points at Fly.io or a droplet.

## Switches (`wrangler.jsonc` `vars` — not secrets)

| Var | Default | Meaning |
|-----|---------|---------|
| `ANIMA_CHAT_BRAIN` | `cloudflare` (committed) | `cloudflare`: chat + background jobs on Workers AI; every `ANIMA_LOCAL_LLM_*` value is ignored. `self-hosted` / unset: old behaviour, prefer `ANIMA_LOCAL_LLM_BASE_URL`. |
| `ANIMA_WORKERS_AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Chat model id (`@cf/…` or `@hf/…`). Llama 3.3 70B is non-reasoning, so replies start streaming quickly. A reasoning model such as `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` still works — its `<think>` output is stripped. |
| `ANIMA_WORKERS_AI_LORA` | unset | Workers AI LoRA fine-tune name/id applied to the chat model — the hosted version of the `anima-chat` fine-tune. The base model must be LoRA-capable (see Cloudflare "Workers AI fine-tunes"). |
| `ANIMA_WORKERS_AI_BACKGROUND_MODEL` | `@cf/meta/llama-3.1-8b-instruct` | Model for background brain jobs. |
| `ANIMA_WORKERS_AI_BACKGROUND` | on | `false` keeps background jobs off Workers AI (saves free-plan neurons for chat). |

## Secrets — what to set, where

Nothing new. The brain uses bindings that already exist on the Worker:

| Name | Where | Used for |
|------|-------|----------|
| `AI` binding | `wrangler.jsonc` `ai` (already there) | Chat, background jobs, embeddings |
| `HYPERDRIVE` | `wrangler.jsonc` (already there) | Postgres identity + memory |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `DATABASE_URL` | Cloudflare Secrets Store `a31e40473ef34db896b5bc1e6c1c4b86` (already bound) | Auth + DB |
| `OPENROUTER_API_KEY` | Secrets Store (already bound) | Optional fallback after Workers AI quota 4006 |

`ANIMA_LOCAL_LLM_BASE_URL` / `ANIMA_LOCAL_LLM_API_KEY` stay bound so a deploy
cannot fail on a missing binding, but their values are ignored. After this is
live you can shut down the Fly.io app / droplet; delete those two bindings
(and the Secrets Store entries) in a later PR if you never want to go back.

**Plan note:** Workers AI Free is 10,000 neurons/day (error 4006 after that).
Steady chat volume needs Workers Paid; until then `ANIMA_OPENROUTER_FALLBACK=true`
hops to OpenRouter's free model.

## Deploy

Merging to `main` deploys through Workers Builds as today (`pnpm build`, then
`wrangler deploy`). Check afterwards:

```bash
curl -s https://anima-protocol.com/api/healthz/llm | jq "{brain, preferred, chain, backgroundChain, localEndpoint}"
# expect brain="cloudflare", chain[0]="workersai", backgroundChain=["workersai"], localEndpoint.configured=false
curl -s 'https://anima-protocol.com/api/healthz/llm?probe=1' | jq '.probes'
```

To go back to a self-hosted model host, set `ANIMA_CHAT_BRAIN` to
`self-hosted` in `wrangler.jsonc` and redeploy.
