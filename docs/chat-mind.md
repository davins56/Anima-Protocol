# Chat mind

The chat mind is how a companion reply gets built on hosted models (Workers AI,
with OpenRouter as the optional fallback). It replaces the prompt packing that
was tuned for a 0.5B model on a 1-vCPU droplet. Nothing new to host: it runs
in the existing Cloudflare Worker and uses Postgres via Hyperdrive. **No
migration** is needed.

Code: `artifacts/api-server/src/lib/mind/`. Wiring: `routes/chat.ts`,
`lib/promptBuilder.ts` (`mind` option), `lib/llmFailover.ts` / `lib/workersAi.ts`
(`sampling`, `excludeProviders`).

## What was wrong (audit)

The same prompt rules applied whether the model was a 0.5B Qwen or Llama 3.3 70B:

| Problem | Effect |
|---|---|
| Whole prompt capped at **1,240 tokens** (`LOCAL_PROMPT_MAX_TOKENS`) | A 24k-context model saw about 5% of what it could. |
| Replayed history was **2–6 exchanges**, each message cut to **400 chars** | The companion forgot what was said 3 minutes ago, and long messages lost their endings. |
| Memory was the **first thing dropped** when space ran out (before history) | Long-term recall disappeared on exactly the turns that needed it. |
| Only 4 companion memories and 8 memory-core recalls, none deduped against visible history | Wasted space repeating what was already on screen. |
| "Memories" were raw truncated transcripts (`User: … | Companion: …`) | No durable facts about the user (names, pets, job, plans). |
| Nothing summarized older conversation | Anything beyond the window was gone. |
| Fixed temperature 0.65 and no penalties; OpenRouter got **no** temperature | Flat voice, repeated openers. |
| Persona capped at 500 chars of personality / 500 of backstory | Rich companion cards were cut. |
| Failover only when a stream fails to open | A stream that died before its first token failed the turn. |
| Hosted streams had no output guard | A `Name:` label, `<|eot_id|>`, or a run-on into "User: …" could reach the bubble. |
| A system note in the middle of the message list | Mistral/Gemma templates reject or drop it. |

## What the mind does

Per turn, before the stream (inside the existing 1.2s optional-context budget):

1. **Profile** (`profile.ts`, `active.ts`): the model that will answer decides
   the budget and sampling. Hosted only; the self-hosted path is unchanged.
2. **Knowledge** (`mindContext.ts`, `hybridRecall.ts`): durable user facts,
   the rolling summary of this conversation, and recalled `memory_events`
   moments are ranked together:
   `0.55·similarity + 0.20·recency + 0.25·importance` (keyword overlap stands
   in when there is no vector score; facts get a small floor). Near-duplicates
   and moments already visible in history are dropped. The block is packed to
   22% of the prompt budget, with the summary first (capped at 40% of that).
3. **Prompt** (`promptBuilder.ts`, `mind` option): 12,000-token budget
   (clamped per model, see below), the
   last **16 exchanges verbatim** (1,600 chars per message), persona fields up
   to 1,600 chars, up to 8 companion memories. When space is short it drops
   PDFs → lore → repository text → **oldest exchanges** (never below 4) →
   scene → mood detail → memory last.
4. **Anti-repetition**: the closing instruction lists the openings of the
   companion's last replies and asks for something fresh. A reply that mostly
   restates a recent one uses the existing one-shot regenerate.
5. **Template shaping** (`templates.ts`): consecutive same-role turns are
   merged. Mistral/Gemma get one leading system message and strict
   user/assistant alternation; Llama keeps the closing system note.
6. **Sampling** (per family): Llama 0.8 temp / top_p 0.9 / repetition 1.05 /
   frequency 0.15 / presence 0.1; R1 0.6/0.95; Mistral, Qwen, Gemma tuned
   likewise. It is sent to Workers AI and OpenRouter.

During the stream:

7. **Persona stream guard** (`personaGuard.ts`): holds a 48-char tail and
   strips template tokens, a leading `Ava:` self-label and scaffolding lines
   (`[System …]`, `(OOC: …)`). It stops the stream when the model starts
   writing the user's turn. The saved reply gets the same cleanup.
8. **Mid-stream fallback** (`streamFallback.ts`): if the stream dies
   before any text is shown, the turn reopens once on the next provider
   (`excludeProviders`). It never splices a second model onto text the user
   already saw.

After the stream (in the existing post-stream background block, kept alive
with `ctx.waitUntil`, on the background model `ANIMA_WORKERS_AI_BACKGROUND_MODEL`):

9. **Fact extraction** (`userFacts.ts`, `postTurn.ts`): one JSON-only call
   per turn (skipped for lines under 4 words). It stores up to 6 durable
   facts as `memory_events` `note` rows with `payload.kind = "user_fact"`. An
   updated fact (an explicit `replaces`, or the same statement with flipped
   polarity, e.g. "is not allergic") appends a `retraction` for the old one,
   which is the existing forget mechanism. Facts are **shared across the
   user's companions** (see below).
10. **Rolling summary** (`rollingSummary.ts`): once 12 or more messages have
    aged out of the 16-exchange window, the next call merges them into a
    summary of 180 words or less, stored as a `note` with
    `payload.kind = "session_summary"` and `through_seq`.

Time to first token is unchanged in shape: the extra reads run in parallel
with the existing context loads, and all learning happens after `done`.

## Shared user facts (privacy)

What a user tells one companion about **themselves** (name, pets, job, city,
preferences, plans, boundaries) is known to **all of that user's companions**.
Facts are never shared across users: every read and write is keyed by
`user_id`, and the unique `(user_id, dedupe_key)` constraint keys shared
facts as `fact:user:<hash>`, so a fact told to two companions is one row.

- **Shared** (`payload.scope = "user"`): ordinary turns.
- **Private to the companion** (`payload.scope = "companion"`, key
  `fact:<characterId>:<hash>`): facts learned in **therapy** mode or during
  **adult** turns stay with the companion they were told to. A private turn
  can add a private fact, but it never retracts a shared one.
- **Stays per companion:** recalled moments (`turn` events and other
  memory_events), the rolling conversation summary, and the identity anchor.
- **Bookkeeping:** each fact still carries the `character_id` of the
  companion that learned it, plus `payload.learned_from_character_id`.
  Forgetting a fact (a `retraction`) removes it for every companion.
- **No migration:** this uses the existing `memory_events` columns and
  indexes. The read filters on `user_id` (the leading column of the existing
  indexes) plus `event_type` and `payload->>'kind'`.

## Prompt budget and context windows

The default budget is **12,000 tokens**. Each turn's budget is clamped so the
prompt fits **every model the turn might use**: the primary model and any
failover/fallback model in the chain, because the same messages are replayed
on fallback.

`fit = (context window − reply reserve) × 0.85`

- The reply reserve is 1,024 tokens (the companion reply cap), or 4,096 for
  reasoning models (R1) that think before answering.
- The 0.85 factor leaves room for the ~4 chars/token estimate running low on
  names, emoji and non-English text.

| Model | Context | Prompt budget |
|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default) | 24,000 | 12,000 (the fit is ~19,500) |
| `@cf/meta/llama-3.1-8b-instruct` | 7,968 | ~5,900 |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | 80,000 | 12,000 |
| Venice / dolphin-mistral-24b (OpenRouter) | 32,768 | 12,000 |
| Unknown model | 8,192 (assumed) | ~6,100 |

The table lives in `profile.ts` (`MODEL_CONTEXT_WINDOWS`). For a model not in
the table, set `ANIMA_MIND_CONTEXT_TOKENS` to its real window. Inside the
budget, the trim order in step 3 decides what goes first. History never drops
below 4 exchanges.

## Companion identity ("are you real or an AI?")

The rule depends on who the companion is (`identityRuleFor` in
`src/lib/promptBuilder.ts`, `isPreinstalledCharacter` in
`src/lib/companions/builtIn.ts`):

| Companion | How it is detected | What it says |
|---|---|---|
| Pre-installed roster (Korra, Tony Stark, …) | id starts with `seed_` (the stable `seedId` from `seedCharacters.js`) or `is_starter: true` | Never says it is an AI or an Anima. Stays fully in character and deflects playfully and warmly, never curtly, then carries on. |
| Companions the user created, and the user's own Anima (Serenity / Aeland / Scarlet) | anything else | Knows it is an Anima and may say so warmly, in its own voice ("I'm an Anima … what we share is real to me"). |

In a group scene, if any speaker is pre-installed, the concealing rule is used.
No companion ever calls itself an AI, language model, chatbot or Qwen. The hosted
mind gets the fuller wording; the local 0.5B path gets a short version so its
1,240-token prefix still fits. Therapy, crisis and the highest-priority safety
rule are unchanged.

**Follow the user's lead** (hosted mind only, in the closing note): stay with
what the user just brought up instead of steering back to their earlier
problems, and only ask a question when it truly helps. It is left out of
therapy mode and crisis/care turns, which keep their own safety contract.

## Settings

| Var | Default | Meaning |
|---|---|---|
| `ANIMA_CHAT_MIND` | `on` | `off` returns hosted chat to the legacy packing. |
| `ANIMA_MIND_PROMPT_TOKENS` | `12000` | Requested prompt budget (1,500–100,000), always clamped to the smallest context window in the chain. |
| `ANIMA_MIND_CONTEXT_TOKENS` | per model | Override the assumed context window (for a model not in the table). |
| `ANIMA_MIND_HISTORY_EXCHANGES` | `16` | Verbatim exchanges replayed (4–40). |
| `ANIMA_MIND_TEMPERATURE` | per family | Override the sampling temperature. |

All of these are plain `vars`; none are secrets. `ANIMA_MEMORY_CORE=off` also
turns off mind knowledge and learning.

## Cost (background learning is on by default)

After each reply, the mind makes background calls on the 8B background model
(`ANIMA_WORKERS_AI_BACKGROUND_MODEL`):

- **Fact extraction:** one call per user turn of 4+ words. Roughly 1–1.5k
  input tokens and up to 320 output tokens.
- **Rolling summary:** one call about every 6 exchanges, once 12 messages
  have aged out of the window. Up to ~3k input tokens and up to 420 output
  tokens.

The reply itself is a 70B call with up to 12k prompt tokens, which is
several times the cost of these 8B calls. Background learning roughly doubles
the background (8B) neurons per turn and adds a modest share on top of the
reply. On **Workers AI Free (10,000 neurons/day)** that is noticeable. Use
Workers Paid for real traffic.

**Switches:**

- `ANIMA_WORKERS_AI_BACKGROUND=false` stops **all** background model calls:
  fact extraction, summaries, and the existing evolution / consolidation /
  dream jobs. The mind keeps reading facts and summaries it already has.
- `ANIMA_MIND_PROMPT_TOKENS=6000` halves the prompt size, and with it most
  of the reply cost.
- `ANIMA_CHAT_MIND=off` restores the legacy prompt entirely.

## Checks

```bash
cd artifacts/api-server
npx vitest run --config vitest.unit.config.ts   # includes test/mind*.test.ts (no Postgres)
pnpm run eval:mind                              # scripted multi-turn eval
```

`eval:mind` uses a mock model unless `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` are set. With both set, the reply-level checks call
Workers AI with the production model and sampling. It compares legacy and
mind prompts on fact recall 40 exchanges back, a detail 12 exchanges back,
summary carry-over, the budget on a long chat, strict-template shape,
cross-companion fact sharing (with therapy facts and other users excluded),
and the per-model context clamp.
